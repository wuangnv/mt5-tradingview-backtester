from __future__ import annotations

import csv
import io
from copy import deepcopy

from .prop_session import ChallengeAttemptSnapshot, PhaseStateSnapshot, PropSessionSnapshot


TERMINAL_ATTEMPT_STATUSES = {"completed_pass", "failed_breach", "expired", "abandoned"}


def _breach_reason_codes(objectives: dict | None) -> list[str]:
    if not isinstance(objectives, dict):
        return []
    money = objectives.get("money")
    if not isinstance(money, dict):
        return []
    reasons = []
    daily = money.get("daily_loss")
    if isinstance(daily, dict) and daily.get("breached") is True:
        reasons.append("daily_loss_breached")
    overall = money.get("overall_drawdown")
    if isinstance(overall, dict) and overall.get("breached") is True:
        reasons.append("overall_drawdown_breached")
    return reasons


def _breach_details(objectives: dict | None) -> list[dict]:
    if not isinstance(objectives, dict):
        return []
    money = objectives.get("money")
    if not isinstance(money, dict):
        return []
    details = []
    for rule, key in (("daily_loss", "daily_loss"), ("overall_drawdown", "overall_drawdown")):
        value = money.get(key)
        if not isinstance(value, dict) or value.get("breached") is not True:
            continue
        details.append(
            {
                "rule": rule,
                "current": value.get("current"),
                "floor": value.get("floor"),
                "reference": value.get("reference"),
            }
        )
    return details


def build_prop_attempt_report(
    session: PropSessionSnapshot,
    attempt: ChallengeAttemptSnapshot,
    phase: PhaseStateSnapshot,
    resume_state: dict | None,
) -> dict:
    """Build a read-only report from canonical persisted Prop simulation state."""

    resume = deepcopy(resume_state or {})
    lifecycle = resume.get("prop_lifecycle")
    objectives = deepcopy(lifecycle.get("last_objectives")) if isinstance(lifecycle, dict) else None
    replay_binding = deepcopy(resume.get("replay_binding")) if isinstance(resume.get("replay_binding"), dict) else None
    branch_provenance = (
        deepcopy(resume.get("branch_provenance"))
        if isinstance(resume.get("branch_provenance"), dict)
        else None
    )
    reason_codes = _breach_reason_codes(objectives)
    if isinstance(objectives, dict) and objectives.get("technical_status") == "blocked_by_data":
        reason_codes.append("data_quality_incomplete")
    if attempt.status == "expired":
        reason_codes.append("virtual_cutoff_expired")
    elif attempt.status == "abandoned":
        reason_codes.append("attempt_abandoned")
    elif attempt.status == "completed_pass":
        reason_codes.append("declared_objectives_satisfied")

    return {
        "schema_version": "prop-attempt-report-v1",
        "mode": "simulation",
        "result_source": "replay_simulation" if replay_binding is not None else "simulation",
        "broker_execution_capability": False,
        "session": {
            "session_id": session.session_id,
            "session_type": session.session_type,
            "status": session.status,
            "revision": session.revision,
        },
        "profile": {
            "profile_id": session.profile.profile_id,
            "terms_version": session.profile.terms_version,
            "profile_hash": session.profile.profile_hash,
            "effective_from": session.profile.effective_from.isoformat(),
            "source_kind": session.profile.source_kind,
        },
        "attempt": {
            "attempt_id": attempt.attempt_id,
            "status": attempt.status,
            "revision": attempt.revision,
            "parent_attempt_id": attempt.parent_attempt_id,
            "branch_kind": attempt.branch_kind,
            "data_version": attempt.data_version,
            "cost_version": attempt.cost_version,
            "engine_version": attempt.engine_version,
            "virtual_start_utc": attempt.virtual_start_utc.isoformat().replace("+00:00", "Z"),
            "virtual_cutoff_utc": attempt.virtual_cutoff_utc.isoformat().replace("+00:00", "Z"),
        },
        "phase": {
            "phase_index": phase.phase_index,
            "balance": str(phase.balance),
            "floating_pl": str(phase.floating_pl),
            "equity": str(phase.equity),
            "high_water_mark": str(phase.high_water_mark),
            "daily_anchor": str(phase.daily_anchor),
            "qualifying_days": phase.qualifying_days,
            "virtual_time_utc": phase.virtual_time_utc.isoformat().replace("+00:00", "Z"),
            "last_event_sequence": phase.last_event_sequence,
            "open_positions": phase.open_positions,
            "pending_orders": phase.pending_orders,
            "evaluation_quality": phase.evaluation_quality,
        },
        "objectives": objectives,
        "outcome": {
            "status": attempt.status,
            "terminal": attempt.status in TERMINAL_ATTEMPT_STATUSES,
            "technical_status": objectives.get("technical_status") if isinstance(objectives, dict) else None,
            "terminal_action": objectives.get("terminal_action") if isinstance(objectives, dict) else None,
            "reason_codes": reason_codes,
            "breaches": _breach_details(objectives),
        },
        "provenance": {
            "hindsight_exploratory": attempt.branch_kind == "hindsight_exploratory",
            "replay_binding": replay_binding,
            "branch_provenance": branch_provenance,
        },
        "tutorials": {
            "learn_view_href": "/?view=learn",
            "learn_overview_href": "/api/v2/learn/overview",
            "answer_keys_exposed": False,
            "auto_completion_enabled": False,
        },
        "safety": {
            "simulation_only": True,
            "broker_results_included": False,
            "broker_credentials_included": False,
            "holdout_content_included": False,
        },
    }


def prop_attempt_report_csv(report: dict) -> str:
    """Export stable summary fields without serializing arbitrary nested state."""

    session = report["session"]
    attempt = report["attempt"]
    phase = report["phase"]
    outcome = report["outcome"]
    provenance = report["provenance"]
    row = {
        "schema_version": report["schema_version"],
        "mode": report["mode"],
        "result_source": report["result_source"],
        "session_id": session["session_id"],
        "session_status": session["status"],
        "session_revision": session["revision"],
        "attempt_id": attempt["attempt_id"],
        "attempt_status": attempt["status"],
        "attempt_revision": attempt["revision"],
        "branch_kind": attempt["branch_kind"],
        "data_version": attempt["data_version"],
        "cost_version": attempt["cost_version"],
        "engine_version": attempt["engine_version"],
        "phase_index": phase["phase_index"],
        "balance": phase["balance"],
        "equity": phase["equity"],
        "high_water_mark": phase["high_water_mark"],
        "qualifying_days": phase["qualifying_days"],
        "virtual_time_utc": phase["virtual_time_utc"],
        "evaluation_quality": phase["evaluation_quality"],
        "terminal": outcome["terminal"],
        "terminal_action": outcome["terminal_action"],
        "reason_codes": "|".join(outcome["reason_codes"]),
        "hindsight_exploratory": provenance["hindsight_exploratory"],
        "broker_execution_capability": report["broker_execution_capability"],
    }
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=list(row))
    writer.writeheader()
    writer.writerow(row)
    return output.getvalue()
