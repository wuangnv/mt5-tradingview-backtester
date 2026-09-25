from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from .prop_session import (
    ChallengeAttemptSnapshot,
    PhaseStateSnapshot,
    PropLifecycleEvent,
    PropPhaseSpec,
)
from .replay_execution import ReplayExecutionEvent, ReplayExecutionSnapshot


class ReplayPropConnectionError(ValueError):
    pass


def _data_version_matches(data_version: str, dataset_sha256: str) -> bool:
    value = str(data_version).strip().lower()
    digest = str(dataset_sha256).strip().lower()
    return value in {digest, f"sha256:{digest}"}


def validate_replay_prop_binding(
    snapshot: ReplayExecutionSnapshot,
    attempt: ChallengeAttemptSnapshot,
    phase: PhaseStateSnapshot,
) -> None:
    if attempt.engine_version != "replay-v1":
        raise ReplayPropConnectionError("prop attempt engine_version must be replay-v1")
    if not _data_version_matches(attempt.data_version, snapshot.dataset_sha256):
        raise ReplayPropConnectionError("prop attempt data_version must pin the replay dataset sha256")
    if attempt.cost_version != str(snapshot.cost_model.get("version") or ""):
        raise ReplayPropConnectionError("prop attempt cost_version does not match replay cost model")
    if phase.phase_index != snapshot.phase_index:
        raise ReplayPropConnectionError("prop phase index does not match replay phase index")
    replay_phase_initial = snapshot.phase_initial_balance or snapshot.starting_balance
    if phase.initial_balance != replay_phase_initial:
        raise ReplayPropConnectionError("prop phase initial balance does not match replay starting balance")


def validate_replay_prop_branch_checkpoint(
    child_snapshot: ReplayExecutionSnapshot,
    *,
    child_payload: dict,
    parent_snapshot: ReplayExecutionSnapshot,
    historical_attempt: ChallengeAttemptSnapshot,
    phase: PhaseStateSnapshot,
    resume_state: dict,
) -> None:
    """Validate one immutable Prop checkpoint against a historical Replay branch boundary."""

    validate_replay_prop_binding(child_snapshot, historical_attempt, phase)
    if child_snapshot.replay_session_id == parent_snapshot.replay_session_id:
        raise ReplayPropConnectionError("replay branch must use a distinct child session")
    if child_payload.get("parent_session_id") != parent_snapshot.replay_session_id:
        raise ReplayPropConnectionError("replay branch parent lineage is inconsistent")
    if child_payload.get("branch_id") != child_snapshot.branch_id:
        raise ReplayPropConnectionError("replay branch payload does not match child execution lineage")
    if int(child_payload.get("cursor_index", -1)) != child_snapshot.cursor_index:
        raise ReplayPropConnectionError("replay branch payload cursor does not match child execution")
    try:
        checkpoint_sequence = int(child_payload.get("parent_checkpoint_event_sequence"))
    except (TypeError, ValueError) as exc:
        raise ReplayPropConnectionError("replay branch checkpoint event sequence is invalid") from exc
    if checkpoint_sequence != child_snapshot.event_sequence:
        raise ReplayPropConnectionError("replay branch checkpoint event sequence does not match child execution")
    if (
        child_snapshot.dataset_id != parent_snapshot.dataset_id
        or child_snapshot.dataset_sha256 != parent_snapshot.dataset_sha256
        or child_snapshot.instrument_spec != parent_snapshot.instrument_spec
        or child_snapshot.cost_model != parent_snapshot.cost_model
        or child_snapshot.starting_balance != parent_snapshot.starting_balance
    ):
        raise ReplayPropConnectionError("replay branch immutable execution pins diverged from its parent")

    binding = resume_state.get("replay_binding")
    if not isinstance(binding, dict):
        raise ReplayPropConnectionError("historical prop checkpoint is not bound to Replay")
    expected_binding = {
        "replay_session_id": parent_snapshot.replay_session_id,
        "branch_id": parent_snapshot.branch_id,
        "dataset_id": child_snapshot.dataset_id,
        "dataset_sha256": child_snapshot.dataset_sha256,
        "last_replay_event_sequence": child_snapshot.event_sequence,
    }
    for key, expected in expected_binding.items():
        if binding.get(key) != expected:
            raise ReplayPropConnectionError("historical prop checkpoint does not match Replay branch boundary")

    cursor = resume_state.get("cursor")
    if not isinstance(cursor, dict) or cursor.get("bar_index") != child_snapshot.cursor_index:
        raise ReplayPropConnectionError("historical prop checkpoint cursor does not match Replay branch boundary")
    timestamp = cursor.get("timestamp_utc")
    if not isinstance(timestamp, str):
        raise ReplayPropConnectionError("historical prop checkpoint timestamp is invalid")
    try:
        cursor_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError as exc:
        raise ReplayPropConnectionError("historical prop checkpoint timestamp is invalid") from exc
    checkpoint_event = None
    for item in reversed(child_snapshot.ledger):
        try:
            candidate = ReplayExecutionEvent.model_validate(item)
        except ValueError as exc:
            raise ReplayPropConnectionError("replay branch checkpoint ledger is invalid") from exc
        if candidate.sequence == child_snapshot.event_sequence:
            checkpoint_event = candidate
            break
    if checkpoint_event is None:
        raise ReplayPropConnectionError("replay branch checkpoint event is missing")
    replay_time = datetime.fromtimestamp(checkpoint_event.virtual_time_utc, tz=timezone.utc)
    if cursor_time != replay_time or phase.virtual_time_utc.astimezone(timezone.utc) != replay_time:
        raise ReplayPropConnectionError("historical prop checkpoint time does not match Replay branch boundary")
    if (
        phase.balance != child_snapshot.balance
        or phase.floating_pl != child_snapshot.floating_pl
        or phase.equity != child_snapshot.equity
    ):
        raise ReplayPropConnectionError("historical prop checkpoint money does not match Replay branch boundary")

    expected_position = child_snapshot.position.model_dump(mode="json") if child_snapshot.position is not None else None
    expected_positions = [expected_position] if expected_position is not None else []
    expected_pending = (
        [child_snapshot.pending_market_order.model_dump(mode="json")]
        if child_snapshot.pending_market_order is not None
        else []
    )
    if phase.open_positions != len(expected_positions) or resume_state.get("open_positions", []) != expected_positions:
        raise ReplayPropConnectionError("historical prop checkpoint position state does not match Replay branch boundary")
    if phase.pending_orders != len(expected_pending) or resume_state.get("pending_orders", []) != expected_pending:
        raise ReplayPropConnectionError("historical prop checkpoint pending state does not match Replay branch boundary")


def validate_replay_prop_transition_boundary(
    snapshot: ReplayExecutionSnapshot,
    *,
    replay_payload: dict,
    dataset_row_count: int,
    attempt: ChallengeAttemptSnapshot,
    phase: PhaseStateSnapshot,
    resume_state: dict,
    phase_spec: PropPhaseSpec,
) -> None:
    """Fail closed unless Replay and Prop describe the same phase boundary."""

    validate_replay_prop_binding(snapshot, attempt, phase)
    if replay_payload.get("dataset_id") != snapshot.dataset_id:
        raise ReplayPropConnectionError("replay payload dataset does not match canonical execution")
    if replay_payload.get("branch_id") != snapshot.branch_id:
        raise ReplayPropConnectionError("replay payload branch does not match canonical execution")
    if int(replay_payload.get("cursor_index", -1)) != snapshot.cursor_index:
        raise ReplayPropConnectionError("replay payload cursor does not match canonical execution")
    if replay_payload.get("status") == "completed" or snapshot.cursor_index >= int(dataset_row_count) - 1:
        raise ReplayPropConnectionError("next phase requires a future replay bar")

    binding = resume_state.get("replay_binding")
    if not isinstance(binding, dict):
        raise ReplayPropConnectionError("prop replay binding is required for canonical phase transition")
    expected_lineage = {
        "replay_session_id": snapshot.replay_session_id,
        "branch_id": snapshot.branch_id,
        "dataset_id": snapshot.dataset_id,
        "dataset_sha256": snapshot.dataset_sha256,
    }
    for key, expected in expected_lineage.items():
        if binding.get(key) != expected:
            raise ReplayPropConnectionError("prop replay binding lineage does not match canonical replay")
    try:
        last_replay_event_sequence = int(binding.get("last_replay_event_sequence"))
    except (TypeError, ValueError) as exc:
        raise ReplayPropConnectionError("prop replay binding event sequence is invalid") from exc
    if last_replay_event_sequence != snapshot.event_sequence:
        raise ReplayPropConnectionError("canonical replay has unconsumed progression at the phase boundary")

    boundary_event = None
    for item in reversed(snapshot.ledger):
        try:
            item_sequence = int(item.get("sequence", -1))
        except (TypeError, ValueError) as exc:
            raise ReplayPropConnectionError("canonical replay ledger sequence is invalid") from exc
        if item_sequence != snapshot.event_sequence:
            continue
        try:
            boundary_event = ReplayExecutionEvent.model_validate(item)
        except ValueError as exc:
            raise ReplayPropConnectionError("canonical replay boundary event is invalid") from exc
        break
    if boundary_event is None or boundary_event.kind != "price_mark":
        raise ReplayPropConnectionError("phase transition requires the latest canonical replay price mark")

    cursor = resume_state.get("cursor")
    if not isinstance(cursor, dict) or cursor.get("bar_index") != snapshot.cursor_index:
        raise ReplayPropConnectionError("prop resume cursor does not match canonical replay cursor")
    timestamp = cursor.get("timestamp_utc")
    if not isinstance(timestamp, str):
        raise ReplayPropConnectionError("prop resume cursor timestamp is invalid")
    try:
        resume_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError as exc:
        raise ReplayPropConnectionError("prop resume cursor timestamp is invalid") from exc
    boundary_time = datetime.fromtimestamp(boundary_event.virtual_time_utc, tz=timezone.utc)
    phase_time = phase.virtual_time_utc.astimezone(timezone.utc)
    if resume_time != boundary_time or phase_time != boundary_time:
        raise ReplayPropConnectionError("prop virtual time does not match canonical replay boundary")

    if (
        phase.balance != snapshot.balance
        or phase.floating_pl != snapshot.floating_pl
        or phase.equity != snapshot.equity
    ):
        raise ReplayPropConnectionError("prop money state does not match canonical replay boundary")
    if snapshot.pending_market_order is not None or phase.pending_orders != 0:
        raise ReplayPropConnectionError("phase transition requires zero pending replay orders")
    if resume_state.get("pending_orders") not in (None, []):
        raise ReplayPropConnectionError("prop pending order state does not match canonical replay boundary")

    expected_position = snapshot.position.model_dump(mode="json") if snapshot.position is not None else None
    expected_positions = [expected_position] if expected_position is not None else []
    if phase.open_positions != len(expected_positions):
        raise ReplayPropConnectionError("prop open position count does not match canonical replay boundary")
    if resume_state.get("open_positions") != expected_positions:
        raise ReplayPropConnectionError("prop open position state does not match canonical replay boundary")
    if snapshot.position is not None and phase_spec.position_policy == "close_by_simulator":
        raise ReplayPropConnectionError("close_by_simulator with an open replay position is not supported yet")
    if snapshot.position is not None and not (
        phase_spec.position_policy == "carry" and phase_spec.carry_policy == "carry_all"
    ):
        raise ReplayPropConnectionError("open replay position is incompatible with the frozen phase carry policy")


def validate_replay_prop_transition_result(
    snapshot: ReplayExecutionSnapshot,
    *,
    attempt: ChallengeAttemptSnapshot,
    phase: PhaseStateSnapshot,
    resume_state: dict,
) -> None:
    validate_replay_prop_binding(snapshot, attempt, phase)
    if (
        phase.balance != snapshot.balance
        or phase.floating_pl != snapshot.floating_pl
        or phase.equity != snapshot.equity
    ):
        raise ReplayPropConnectionError("prop phase transition money state diverged from canonical replay")
    expected_position = snapshot.position.model_dump(mode="json") if snapshot.position is not None else None
    expected_positions = [expected_position] if expected_position is not None else []
    if phase.open_positions != len(expected_positions) or resume_state.get("open_positions") != expected_positions:
        raise ReplayPropConnectionError("prop phase transition position state diverged from canonical replay")
    if snapshot.pending_market_order is not None or phase.pending_orders != 0:
        raise ReplayPropConnectionError("prop phase transition pending state diverged from canonical replay")
    if resume_state.get("pending_orders") not in (None, []):
        raise ReplayPropConnectionError("prop phase transition pending state diverged from canonical replay")
    binding = resume_state.get("replay_binding")
    if not isinstance(binding, dict):
        raise ReplayPropConnectionError("prop replay binding did not advance to the canonical transition event")
    try:
        last_sequence = int(binding.get("last_replay_event_sequence", -1))
    except (TypeError, ValueError) as exc:
        raise ReplayPropConnectionError("prop replay binding transition sequence is invalid") from exc
    if last_sequence != snapshot.event_sequence:
        raise ReplayPropConnectionError("prop replay binding did not advance to the canonical transition event")


def replay_event_operation_id(
    *,
    replay_session_id: str,
    branch_id: str,
    replay_event_sequence: int,
    prop_session_id: str,
    prop_attempt_id: str,
) -> str:
    source = "|".join(
        (
            replay_session_id,
            branch_id,
            str(replay_event_sequence),
            prop_session_id,
            prop_attempt_id,
        )
    ).encode("utf-8")
    return f"replay-prop-{hashlib.sha256(source).hexdigest()[:40]}"


def replay_mark_to_prop_event(
    *,
    workspace_id: str,
    prop_session_id: str,
    prop_attempt_id: str,
    profile_hash: str,
    expected_prop_revision: int,
    prop_event_sequence: int,
    phase_spec: PropPhaseSpec,
    replay_event: ReplayExecutionEvent,
) -> PropLifecycleEvent:
    if replay_event.kind != "price_mark":
        raise ReplayPropConnectionError("only canonical replay price_mark events can feed prop lifecycle")

    quality = replay_event.evaluation_quality
    needs_intrabar_equity = (
        phase_spec.profit_target.basis == "equity"
        or phase_spec.daily_loss.basis == "equity"
        or phase_spec.overall_drawdown.basis == "equity"
        or (
            phase_spec.overall_drawdown.kind == "trailing"
            and phase_spec.overall_drawdown.trailing_granularity == "intraday"
        )
    )
    if needs_intrabar_equity and replay_event.details.get("intrabar_equity_coverage") != "complete":
        quality = "insufficient"

    return PropLifecycleEvent(
        workspace_id=workspace_id,
        session_id=prop_session_id,
        attempt_id=prop_attempt_id,
        profile_hash=profile_hash,
        operation_id=replay_event_operation_id(
            replay_session_id=replay_event.replay_session_id,
            branch_id=replay_event.branch_id,
            replay_event_sequence=replay_event.sequence,
            prop_session_id=prop_session_id,
            prop_attempt_id=prop_attempt_id,
        ),
        expected_revision=expected_prop_revision,
        event_sequence=prop_event_sequence,
        kind="simulation_snapshot",
        virtual_time_utc=datetime.fromtimestamp(replay_event.virtual_time_utc, tz=timezone.utc),
        balance_before_separate_costs=replay_event.balance,
        floating_pl=replay_event.floating_pl,
        accounting="costs_included",
        open_positions=replay_event.open_positions,
        pending_orders=replay_event.pending_orders,
        evaluation_quality=quality,
        qualifying_day=False,
    )
