from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from .artifacts import ArtifactStore
from .prop_replay import (
    ReplayPropConnectionError,
    replay_mark_to_prop_event,
    validate_replay_prop_binding,
)
from .replay_execution import (
    ReplayExecutionEvent,
    ReplayExecutionSnapshot,
    advance_replay_execution,
    initialize_replay_execution,
    queue_market_order,
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

    @staticmethod
    def _execution_snapshot(payload: dict) -> ReplayExecutionSnapshot | None:
        raw = payload.get("execution")
        return ReplayExecutionSnapshot.model_validate(raw) if raw is not None else None

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

    def view(self, workspace_id: str, session_id: str) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        payload = record["payload"]
        manifest, rows = self._dataset_rows(workspace_id, payload["dataset_id"])
        cursor = int(payload["cursor_index"])
        if cursor >= len(rows):
            raise RuntimeError("replay cursor exceeds immutable dataset")
        visible = rows[: cursor + 1]
        return {
            **record,
            "dataset_sha256": manifest.artifact_sha256,
            "cutoff_timestamp": int(visible[-1]["timestamp"]),
            "visible_rows": visible,
            "visible_row_count": len(visible),
            "total_row_count": len(rows),
            "has_future_rows": cursor + 1 < len(rows),
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

    def branch(self, workspace_id: str, session_id: str, expected_revision: int, cursor_index: int) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        if record["payload"].get("execution") is not None:
            raise ValueError("execution-enabled replay branching requires a canonical checkpoint and is not supported yet")
        current_cursor = int(record["payload"]["cursor_index"])
        if cursor_index > current_cursor:
            raise ValueError("branch cursor cannot exceed current replay cursor")
        payload = {
            "dataset_id": record["payload"]["dataset_id"],
            "cursor_index": int(cursor_index),
            "branch_id": uuid4().hex,
            "parent_session_id": session_id,
            "parent_revision": int(expected_revision),
            "status": "paused",
        }
        branched = self.store.create_record(workspace_id, "replay", payload)
        return self.view(workspace_id, branched["record_id"])

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
            ReplayExecutionEvent.model_validate(item)
            for item in snapshot.ledger
            if item.get("kind") == "price_mark"
        ]
        selected = next((item for item in marks if item.sequence == replay_event_sequence), None)
        if selected is None:
            raise LookupError("replay price_mark event not found")

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

        if replay_event_sequence < last_replay_event_sequence:
            raise ReplayPropConnectionError("replay lifecycle events cannot move backwards")
        if replay_event_sequence > last_replay_event_sequence:
            next_marks = [item.sequence for item in marks if item.sequence > last_replay_event_sequence]
            if not next_marks or replay_event_sequence != min(next_marks):
                raise ReplayPropConnectionError("replay price_mark events must feed prop lifecycle in order")

        if prop_event_sequence not in {phase.last_event_sequence, phase.last_event_sequence + 1}:
            raise ReplayPropConnectionError("prop event sequence is not the next event or an exact retry")

        prop_event = replay_mark_to_prop_event(
            workspace_id=workspace_id,
            prop_session_id=prop_session_id,
            prop_attempt_id=prop_attempt_id,
            profile_hash=attempt.profile_hash,
            expected_prop_revision=expected_prop_revision,
            prop_event_sequence=prop_event_sequence,
            phase_spec=session.profile.phases[phase.phase_index - 1],
            replay_event=selected,
        )
        event_position = selected.details.get("open_position")
        event_pending = selected.details.get("pending_market_order")
        next_resume = dict(resume)
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
