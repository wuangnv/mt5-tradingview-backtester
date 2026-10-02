from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import ValidationError

from .artifacts import ArtifactStore
from .contracts import ReplaySessionCatalogItem
from .prop_replay import (
    ReplayPropConnectionError,
    replay_event_operation_id,
    replay_mark_to_prop_event,
    validate_replay_prop_binding,
)
from .replay_execution import (
    ReplayExecutionError,
    ReplayExecutionSnapshot,
    advance_replay_execution,
    fork_replay_execution_checkpoint,
    initialize_replay_execution,
    parse_replay_execution_snapshot,
    queue_market_order,
    reconstruct_replay_execution_checkpoint,
    replay_event_for_snapshot,
)
from .store import PostgresStore


class ReplayService:
    def __init__(self, store: PostgresStore, artifacts: ArtifactStore):
        self.store = store
        self.artifacts = artifacts

    def _dataset_rows(self, workspace_id: str, dataset_id: str) -> tuple[object, list[dict]]:
        manifest = self.store.get_dataset(workspace_id, dataset_id)
        if manifest is None:
            raise LookupError("dataset not found")
        rows = self.artifacts.read_dataset(manifest.artifact_path, manifest.artifact_sha256)
        return manifest, rows

    def create(self, workspace_id: str, dataset_id: str, start_index: int = 0) -> dict:
        _, rows = self._dataset_rows(workspace_id, dataset_id)
        if start_index >= len(rows):
            raise ValueError("start_index exceeds dataset")
        payload = {
            "dataset_id": dataset_id,
            "cursor_index": int(start_index),
            "branch_id": uuid4().hex,
            "parent_session_id": None,
            "parent_revision": None,
            "status": "paused",
        }
        record = self.store.create_record(workspace_id, "replay", payload)
        return self.view(workspace_id, record["record_id"])

    def list_sessions(self, workspace_id: str) -> list[dict]:
        """Return a tenant-scoped catalog projection for replay sessions.

        This is deliberately metadata-only.  In particular, it does not call
        :meth:`view`, read the artifact rows, or include the execution ledger.
        A missing dataset is retained as an unavailable catalog item so a
        picker can explain why a session cannot be opened instead of silently
        dropping the user's record.
        """

        items: list[dict] = []
        for record in self.store.list_records(workspace_id, "replay"):
            if not isinstance(record, dict):
                raise RuntimeError("replay catalog record is invalid")
            payload = record.get("payload")
            if not isinstance(payload, dict):
                raise RuntimeError("replay catalog record payload is invalid")

            dataset_id = payload.get("dataset_id")
            if dataset_id is not None and not isinstance(dataset_id, str):
                raise RuntimeError("replay catalog dataset id is invalid")
            manifest = (
                self.store.get_dataset(workspace_id, dataset_id)
                if dataset_id
                else None
            )
            try:
                item = ReplaySessionCatalogItem(
                    record_id=record["record_id"],
                    name=payload.get("name", ""),
                    description=payload.get("description", ""),
                    archived=payload.get("archived", False),
                    revision=record["revision"],
                    dataset_id=dataset_id,
                    instrument_id=manifest.instrument_id if manifest else None,
                    timeframe=manifest.timeframe if manifest else None,
                    timeframe_seconds=manifest.timeframe_seconds if manifest else None,
                    row_count=manifest.row_count if manifest else None,
                    cursor_index=payload.get("cursor_index", 0),
                    status=payload.get("status", "unknown"),
                    branch_id=payload.get("branch_id"),
                    parent_session_id=payload.get("parent_session_id"),
                    parent_revision=payload.get("parent_revision"),
                    dataset_available=manifest is not None,
                    has_execution=payload.get("execution") is not None,
                    created_at_utc=record["created_at_utc"],
                    updated_at_utc=record["updated_at_utc"],
                )
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                raise RuntimeError("replay catalog record is invalid") from exc
            items.append(item.model_dump(mode="json"))
        return items

    def update_metadata(self, workspace_id: str, session_id: str, expected_revision: int, changes: dict) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        if not changes or set(changes) - {"name", "description", "archived"}:
            raise ValueError("only replay metadata can be updated")
        payload = dict(record["payload"])
        payload.update(changes)
        return self.store.update_record(workspace_id, "replay", session_id, expected_revision, payload)

    @staticmethod
    def _execution_snapshot(payload: dict) -> ReplayExecutionSnapshot | None:
        raw = payload.get("execution")
        return parse_replay_execution_snapshot(raw) if raw is not None else None

    @staticmethod
    def _iso_utc(timestamp: int) -> str:
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")

    def initialize_execution(
        self,
        workspace_id: str,
        session_id: str,
        expected_revision: int,
        *,
        instrument_spec: dict,
        cost_model: dict,
        spread_price,
        timeframe_seconds: int,
        starting_balance,
        research_margin=None,
    ) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        payload = dict(record["payload"])
        if payload.get("execution") is not None:
            raise RuntimeError("replay execution is already initialized")
        manifest, _ = self._dataset_rows(workspace_id, payload["dataset_id"])
        if manifest.timeframe_seconds is not None and int(manifest.timeframe_seconds) != int(timeframe_seconds):
            raise ValueError("timeframe_seconds does not match the immutable dataset manifest")
        snapshot = initialize_replay_execution(
            replay_session_id=session_id,
            branch_id=payload["branch_id"],
            dataset_id=payload["dataset_id"],
            dataset_sha256=manifest.artifact_sha256,
            instrument_spec=instrument_spec,
            cost_model=cost_model,
            spread_price=spread_price,
            timeframe_seconds=timeframe_seconds,
            starting_balance=starting_balance,
            cursor_index=int(payload["cursor_index"]),
            research_margin=research_margin,
        )
        if snapshot.instrument_spec["instrument_id"] != manifest.instrument_id:
            raise ValueError("instrument_spec does not match the replay dataset instrument")
        if manifest.instrument_spec is not None:
            manifest_instrument = initialize_replay_execution(
                replay_session_id=session_id,
                branch_id=payload["branch_id"],
                dataset_id=payload["dataset_id"],
                dataset_sha256=manifest.artifact_sha256,
                instrument_spec=manifest.instrument_spec,
                cost_model=cost_model,
                spread_price=spread_price,
                timeframe_seconds=timeframe_seconds,
                starting_balance=starting_balance,
                cursor_index=int(payload["cursor_index"]),
            ).instrument_spec
            if snapshot.instrument_spec != manifest_instrument:
                raise ValueError("instrument_spec does not match the immutable dataset manifest")
        payload["execution"] = snapshot.model_dump(mode="json")
        self.store.update_record(workspace_id, "replay", session_id, expected_revision, payload)
        return self.view(workspace_id, session_id)

    def queue_market_order(
        self,
        workspace_id: str,
        session_id: str,
        expected_revision: int,
        *,
        operation_id: str,
        side: str,
        quantity,
        stop_loss,
        take_profit,
    ) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        payload = dict(record["payload"])
        snapshot = self._execution_snapshot(payload)
        if snapshot is None:
            raise ValueError("replay execution is not initialized")
        if snapshot.cursor_index != int(payload["cursor_index"]):
            raise RuntimeError("replay execution cursor is inconsistent with replay state")
        _, rows = self._dataset_rows(workspace_id, payload["dataset_id"])
        if payload.get("status") == "completed" or snapshot.cursor_index >= len(rows) - 1:
            raise ValueError("market order requires a future replay bar")
        queued = queue_market_order(
            snapshot,
            operation_id=operation_id,
            side=side,
            quantity=quantity,
            stop_loss=stop_loss,
            take_profit=take_profit,
        )
        payload["execution"] = queued.model_dump(mode="json")
        self.store.update_record(workspace_id, "replay", session_id, expected_revision, payload)
        return self.view(workspace_id, session_id)

    def view(self, workspace_id: str, session_id: str, cursor_index: int | None = None) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        payload = record["payload"]
        manifest, rows = self._dataset_rows(workspace_id, payload["dataset_id"])
        canonical_cursor = int(payload["cursor_index"])
        if canonical_cursor >= len(rows):
            raise RuntimeError("replay cursor exceeds immutable dataset")
        view_cursor = canonical_cursor if cursor_index is None else int(cursor_index)
        if view_cursor < 0:
            raise ValueError("view cursor must be nonnegative")
        if view_cursor > canonical_cursor:
            raise ValueError("view cursor cannot exceed current replay cursor")
        visible = rows[: view_cursor + 1]
        return {
            **record,
            "dataset_sha256": manifest.artifact_sha256,
            "cutoff_timestamp": int(visible[-1]["timestamp"]),
            "visible_rows": visible,
            "visible_row_count": len(visible),
            "total_row_count": len(rows),
            "has_future_rows": view_cursor + 1 < len(rows),
            "view_cursor_index": view_cursor,
            "canonical_cursor_index": canonical_cursor,
            "historical_view": view_cursor != canonical_cursor,
        }

    def step(self, workspace_id: str, session_id: str, expected_revision: int, steps: int = 1) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        payload = dict(record["payload"])
        _, rows = self._dataset_rows(workspace_id, payload["dataset_id"])
        current_cursor = int(payload["cursor_index"])
        cursor = min(len(rows) - 1, current_cursor + int(steps))
        execution = self._execution_snapshot(payload)
        execution_events: list[dict] = []
        if execution is not None:
            if execution.cursor_index != current_cursor:
                raise RuntimeError("replay execution cursor is inconsistent with replay state")
            for next_cursor in range(current_cursor + 1, cursor + 1):
                advanced = advance_replay_execution(execution, bar=rows[next_cursor], cursor_index=next_cursor)
                execution = advanced.snapshot
                execution_events.extend(event.model_dump(mode="json") for event in advanced.events)
            payload["execution"] = execution.model_dump(mode="json")
        payload["cursor_index"] = cursor
        payload["status"] = "completed" if cursor == len(rows) - 1 else "paused"
        self.store.update_record(workspace_id, "replay", session_id, expected_revision, payload)
        result = self.view(workspace_id, session_id)
        result["execution_events"] = execution_events
        return result

    def analytics_record(
        self, workspace_id: str, session_id: str,
        cursor_index: int | None = None, cutoff_timestamp: int | None = None,
    ) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        canonical_cursor = int(record["payload"]["cursor_index"])
        if cursor_index is not None and (isinstance(cursor_index, bool) or not isinstance(cursor_index, int)):
            raise ValueError("analytics cursor must be an integer")
        if cutoff_timestamp is not None:
            if isinstance(cutoff_timestamp, bool) or not isinstance(cutoff_timestamp, int):
                raise ValueError("analytics cutoff must be an integer bar timestamp")
            _, rows = self._dataset_rows(workspace_id, record["payload"]["dataset_id"])
            visible = rows[:canonical_cursor + 1]
            if not visible or not int(visible[0]["timestamp"]) <= cutoff_timestamp <= int(visible[-1]["timestamp"]):
                raise ValueError("analytics cutoff is outside the visible replay range")
            cutoff_cursor = max(index for index, row in enumerate(visible) if int(row["timestamp"]) <= cutoff_timestamp)
            if cursor_index is not None and cursor_index != cutoff_cursor:
                raise ValueError("analytics cursor and cutoff disagree")
            cursor_index = cutoff_cursor
        selected_cursor = canonical_cursor if cursor_index is None else cursor_index
        if (isinstance(selected_cursor, bool) or not isinstance(selected_cursor, int)
                or not 0 <= selected_cursor <= canonical_cursor):
            raise ValueError("analytics cursor is outside the visible replay range")
        payload = dict(record["payload"])
        snapshot = self._execution_snapshot(payload)
        if selected_cursor < canonical_cursor and snapshot is not None:
            try:
                checkpoint = reconstruct_replay_execution_checkpoint(snapshot, cursor_index=selected_cursor)
            except ReplayExecutionError as exc:
                if str(exc) != "execution branch cursor has no canonical checkpoint":
                    raise ValueError(str(exc)) from exc
                # Initialization has no price-mark event. Its immutable revision
                # is the only valid fallback; never substitute the current state.
                checkpoint = None
                for prior in reversed(self.store.list_record_revisions(workspace_id, "replay", session_id)):
                    if prior["revision"] <= record["revision"] and prior["payload"].get("cursor_index") == selected_cursor:
                        checkpoint = self._execution_snapshot(prior["payload"])
                        if checkpoint is not None:
                            break
                if checkpoint is None:
                    raise ValueError("historical analytics checkpoint is unavailable")
            for field in ("replay_session_id", "branch_id", "dataset_id", "dataset_sha256",
                          "instrument_spec", "cost_model", "spread_price", "timeframe_seconds", "starting_balance",
                          "schema_version", "research_margin"):
                if getattr(checkpoint, field, None) != getattr(snapshot, field, None):
                    raise ValueError("historical analytics checkpoint lineage is inconsistent")
            if checkpoint.cursor_index != selected_cursor:
                raise ValueError("historical analytics checkpoint cursor is inconsistent")
            payload["execution"] = checkpoint.model_dump(mode="json")
        payload["cursor_index"] = selected_cursor
        return {**record, "payload": payload, "view_cursor_index": selected_cursor,
                "canonical_cursor_index": canonical_cursor, "historical_view": selected_cursor < canonical_cursor}

    def branch(self, workspace_id: str, session_id: str, expected_revision: int, cursor_index: int) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        current_cursor = int(record["payload"]["cursor_index"])
        if cursor_index < 0:
            raise ValueError("branch cursor must be nonnegative")
        if cursor_index > current_cursor:
            raise ValueError("branch cursor cannot exceed current replay cursor")
        child_session_id = uuid4().hex
        child_branch_id = uuid4().hex
        payload = {
            "dataset_id": record["payload"]["dataset_id"],
            "cursor_index": int(cursor_index),
            "branch_id": child_branch_id,
            "parent_session_id": session_id,
            "parent_revision": int(expected_revision),
            "status": "paused",
        }
        current_execution = self._execution_snapshot(record["payload"])
        if current_execution is not None:
            checkpoint = None
            checkpoint_revision = None
            checkpoint_source = None
            for historical in reversed(self.store.list_record_revisions(workspace_id, "replay", session_id)):
                if int(historical["revision"]) > int(expected_revision):
                    continue
                historical_payload = historical["payload"]
                if int(historical_payload.get("cursor_index", -1)) != int(cursor_index):
                    continue
                historical_execution = self._execution_snapshot(historical_payload)
                if historical_execution is None:
                    continue
                if historical_execution.cursor_index != int(cursor_index):
                    raise RuntimeError("historical replay execution cursor is inconsistent with replay state")
                checkpoint = historical_execution
                checkpoint_revision = int(historical["revision"])
                checkpoint_source = "record_revision"
                break
            if checkpoint is None:
                try:
                    checkpoint = reconstruct_replay_execution_checkpoint(
                        current_execution,
                        cursor_index=int(cursor_index),
                    )
                except ReplayExecutionError as exc:
                    raise ValueError(str(exc)) from exc
                checkpoint_revision = int(expected_revision)
                checkpoint_source = "ledger_price_mark"

            immutable_fields = (
                "replay_session_id",
                "branch_id",
                "dataset_id",
                "dataset_sha256",
                "instrument_spec",
                "cost_model",
                "spread_price",
                "timeframe_seconds",
                "starting_balance",
                "schema_version",
                "research_margin",
            )
            for field in immutable_fields:
                if getattr(checkpoint, field, None) != getattr(current_execution, field, None):
                    raise RuntimeError("historical replay execution checkpoint is inconsistent with current lineage")
            try:
                forked_execution = fork_replay_execution_checkpoint(
                    checkpoint,
                    replay_session_id=child_session_id,
                    branch_id=child_branch_id,
                )
            except ReplayExecutionError as exc:
                raise ValueError(str(exc)) from exc
            payload.update(
                {
                    "execution": forked_execution.model_dump(mode="json"),
                    "parent_checkpoint_revision": checkpoint_revision,
                    "parent_checkpoint_event_sequence": checkpoint.event_sequence,
                    "parent_checkpoint_source": checkpoint_source,
                }
            )
        branched = self.store.create_replay_branch_record(
            workspace_id,
            session_id,
            expected_revision,
            child_session_id,
            payload,
        )
        return self.view(workspace_id, branched["record_id"])

    def branch_prop_attempt(
        self,
        workspace_id: str,
        replay_session_id: str,
        *,
        prop_session_id: str,
        parent_attempt_id: str,
        expected_replay_revision: int,
        expected_parent_replay_revision: int,
        expected_parent_attempt_revision: int,
        operation_id: str,
    ) -> dict:
        result = self.store.create_prop_branch_attempt(
            workspace_id,
            replay_session_id,
            prop_session_id=prop_session_id,
            parent_attempt_id=parent_attempt_id,
            expected_replay_revision=expected_replay_revision,
            expected_parent_replay_revision=expected_parent_replay_revision,
            expected_parent_attempt_revision=expected_parent_attempt_revision,
            operation_id=operation_id,
        )
        return {
            "session": result["session"].model_dump(mode="json"),
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
            "duplicate": result["duplicate"],
        }

    def feed_prop_lifecycle(
        self,
        workspace_id: str,
        replay_session_id: str,
        *,
        prop_session_id: str,
        prop_attempt_id: str,
        replay_event_sequence: int,
        expected_prop_revision: int,
        prop_event_sequence: int,
    ) -> dict:
        record = self.store.get_record(workspace_id, "replay", replay_session_id)
        if record is None:
            raise LookupError("replay session not found")
        snapshot = self._execution_snapshot(record["payload"])
        if snapshot is None:
            raise ValueError("replay execution is not initialized")
        prop_state = self.store.get_prop_resume_state(workspace_id, prop_session_id, prop_attempt_id)
        if prop_state is None:
            raise LookupError("prop attempt not found")
        session = prop_state["session"]
        attempt = prop_state["attempt"]
        phase = prop_state["phase"]
        validate_replay_prop_binding(snapshot, attempt, phase)
        if phase.phase_index > len(session.profile.phases):
            raise ReplayPropConnectionError("prop phase index is outside the frozen profile")

        marks = [
            replay_event_for_snapshot(snapshot, item)
            for item in snapshot.ledger
            if item.get("kind") == "price_mark"
        ]
        selected = next((item for item in marks if item.sequence == replay_event_sequence), None)
        if selected is None:
            raise LookupError("replay price_mark event not found")

        operation_id = replay_event_operation_id(
            replay_session_id=replay_session_id,
            branch_id=snapshot.branch_id,
            replay_event_sequence=selected.sequence,
            prop_session_id=prop_session_id,
            prop_attempt_id=prop_attempt_id,
        )
        prior_mutation = self.store.get_prop_mutation_snapshot(
            workspace_id,
            prop_session_id,
            prop_attempt_id,
            operation_id,
        )

        resume = dict(prop_state["resume_state"] or {})
        binding = resume.get("replay_binding")
        last_replay_event_sequence = 0
        if binding is not None:
            if not isinstance(binding, dict):
                raise ReplayPropConnectionError("prop replay binding is invalid")
            expected_lineage = {
                "replay_session_id": replay_session_id,
                "branch_id": snapshot.branch_id,
                "dataset_id": snapshot.dataset_id,
                "dataset_sha256": snapshot.dataset_sha256,
            }
            for key, expected in expected_lineage.items():
                if binding.get(key) != expected:
                    raise ReplayPropConnectionError("prop attempt is already bound to a different replay lineage")
            last_replay_event_sequence = int(binding.get("last_replay_event_sequence") or 0)

        if replay_event_sequence < last_replay_event_sequence and prior_mutation is None:
            raise ReplayPropConnectionError("replay lifecycle events cannot move backwards")
        if prior_mutation is None and replay_event_sequence > last_replay_event_sequence:
            next_marks = [item.sequence for item in marks if item.sequence > last_replay_event_sequence]
            if not next_marks or replay_event_sequence != min(next_marks):
                raise ReplayPropConnectionError("replay price_mark events must feed prop lifecycle in order")

        event_phase = prior_mutation["phase"] if prior_mutation is not None else phase
        if prior_mutation is None and prop_event_sequence not in {phase.last_event_sequence, phase.last_event_sequence + 1}:
            raise ReplayPropConnectionError("prop event sequence is not the next event or an exact retry")

        prop_event = replay_mark_to_prop_event(
            workspace_id=workspace_id,
            prop_session_id=prop_session_id,
            prop_attempt_id=prop_attempt_id,
            profile_hash=attempt.profile_hash,
            expected_prop_revision=expected_prop_revision,
            prop_event_sequence=prop_event_sequence,
            phase_spec=session.profile.phases[event_phase.phase_index - 1],
            replay_event=selected,
        )
        event_position = selected.details.get("open_position")
        event_pending = selected.details.get("pending_market_order")
        next_resume = dict(prior_mutation["resume_state"] if prior_mutation is not None else resume)
        # The Prop store owns this subtree and excludes caller changes to it.
        # Omitting it keeps an exact retry byte-for-byte stable after the store
        # has written the latest objective evaluation into current resume state.
        next_resume.pop("prop_lifecycle", None)
        next_resume["cursor"] = {
            "bar_index": selected.cursor_index,
            "timestamp_utc": self._iso_utc(selected.virtual_time_utc),
        }
        next_resume["open_positions"] = [event_position] if event_position is not None else []
        next_resume["pending_orders"] = [event_pending] if event_pending is not None else []
        next_resume["replay_binding"] = {
            "replay_session_id": replay_session_id,
            "branch_id": snapshot.branch_id,
            "dataset_id": snapshot.dataset_id,
            "dataset_sha256": snapshot.dataset_sha256,
            "last_replay_event_sequence": selected.sequence,
        }
        result = self.store.apply_prop_lifecycle_event(prop_event, resume_state=next_resume)
        return {
            "replay_event": selected.model_dump(mode="json"),
            "prop_event": prop_event.model_dump(mode="json"),
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
            "objectives": result["objectives"],
            "duplicate": result["duplicate"],
        }
