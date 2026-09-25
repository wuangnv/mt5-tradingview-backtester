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
    if phase.initial_balance != snapshot.starting_balance:
        raise ReplayPropConnectionError("prop phase initial balance does not match replay starting balance")


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
