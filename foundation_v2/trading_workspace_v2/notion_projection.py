"""Offline MT5 report projection for the future Notion/index connector.

The project owns the source report and this projection boundary.  This module
only builds a deterministic, sanitized payload and a PREP_ONLY export intent;
it never imports a Notion SDK, opens a network connection, reads a broker, or
mutates a page.  A later connector may use the intent after the owner selects
an exact destination and grants the required permission.
"""

from __future__ import annotations

from collections.abc import Mapping
from hashlib import sha256
import json
import re
from typing import Any


NOTION_PROJECTION_SCHEMA = "mt5-notion-projection-v1"
NOTION_EXPORT_INTENT_SCHEMA = "mt5-notion-export-intent-v1"
NOTION_RECEIPT_SCHEMA = "mt5-notion-export-receipt-v1"
_REPORT_SCHEMA = "prop-attempt-report-v1"
_UTC_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")

# These flags are safe only as false assertions.  They document the gate in
# the generated page without carrying broker/account material into Notion.
_SAFE_FALSE_FLAGS = frozenset(
    {
        "broker_execution_capability",
        "broker_results_included",
        "broker_credentials_included",
        "holdout_content_included",
        "answer_keys_exposed",
        "auto_completion_enabled",
    }
)
_BLOCKED_KEY_EXACT = frozenset(
    {
        "account_id",
        "account_number",
        "account_login",
        "account_ref",
        "account_scope",
        "broker_account",
        "broker_order_id",
        "broker_position_id",
        "broker_result",
        "broker_results",
        "broker_server",
        "credential",
        "credentials",
        "password",
        "secret",
        "api_key",
        "access_token",
        "refresh_token",
        "holdout",
        "holdout_access",
        "holdout_bars",
        "holdout_content",
        "holdout_data",
        "holdout_policy",
    }
)


class NotionProjectionError(ValueError):
    """Raised when a report cannot be safely projected for Notion."""


def _canonical(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise NotionProjectionError("projection contains a non-serializable value") from exc


def _digest(value: Any) -> str:
    return "sha256:" + sha256(_canonical(value).encode("utf-8")).hexdigest()


def _key_name(value: object) -> str:
    return str(value).strip().casefold().replace("-", "_")


def _assert_no_sensitive_keys(value: Any, path: str = "report") -> None:
    """Reject sensitive source fields instead of silently redacting them.

    Failing closed is deliberate: dropping an unexpected account or holdout
    field could make a caller believe that a safe export was produced while
    hiding a schema regression.  Known boolean safety flags are accepted only
    when false and are never copied into generated content as source data.
    """

    if isinstance(value, Mapping):
        for raw_key, child in value.items():
            key = _key_name(raw_key)
            child_path = f"{path}.{key}"
            if key in _SAFE_FALSE_FLAGS:
                if child is not False:
                    raise NotionProjectionError(f"{child_path} must be false")
                continue
            if key in _BLOCKED_KEY_EXACT or any(
                marker in key for marker in ("broker", "holdout", "credential", "password", "secret", "token")
            ):
                raise NotionProjectionError(f"sensitive field is not exportable: {child_path}")
            _assert_no_sensitive_keys(child, child_path)
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _assert_no_sensitive_keys(child, f"{path}[{index}]")


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise NotionProjectionError(f"{path} must be an object")
    return value


def _text(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value:
        raise NotionProjectionError(f"{path} must be a non-empty string")
    return value


def _revision(value: Any, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise NotionProjectionError(f"{path} must be a non-negative integer")
    return value


def _copy_breaches(outcome: Mapping[str, Any]) -> list[dict[str, Any]]:
    breaches = outcome.get("breaches", [])
    if not isinstance(breaches, list):
        raise NotionProjectionError("outcome.breaches must be a list")
    projected: list[dict[str, Any]] = []
    for index, item in enumerate(breaches):
        breach = _mapping(item, f"outcome.breaches[{index}]")
        projected.append(
            {
                "rule": _text(breach.get("rule"), f"outcome.breaches[{index}].rule"),
                "current": breach.get("current"),
                "floor": breach.get("floor"),
                "reference": breach.get("reference"),
            }
        )
    return projected


def build_notion_projection(report: Mapping[str, Any]) -> dict[str, Any]:
    """Build a deterministic generated-only page projection from an MT5 report.

    Only stable report fields are copied.  The free-form objectives and
    provenance payloads remain source-owned and are intentionally excluded.
    """

    if not isinstance(report, Mapping):
        raise NotionProjectionError("report must be an object")
    _assert_no_sensitive_keys(report)
    if report.get("schema_version") != _REPORT_SCHEMA:
        raise NotionProjectionError("unsupported report schema")
    if report.get("mode") != "simulation":
        raise NotionProjectionError("only simulation reports may be projected")
    if report.get("broker_execution_capability") is not False:
        raise NotionProjectionError("broker execution capability must be false")

    safety = _mapping(report.get("safety"), "safety")
    if safety.get("simulation_only") is not True:
        raise NotionProjectionError("source report is not simulation-only")
    for key in ("broker_results_included", "broker_credentials_included", "holdout_content_included"):
        if safety.get(key) is not False:
            raise NotionProjectionError(f"safety.{key} must be false")

    tutorials = _mapping(report.get("tutorials"), "tutorials")
    if tutorials.get("answer_keys_exposed") is not False or tutorials.get("auto_completion_enabled") is not False:
        raise NotionProjectionError("tutorial answer-key/auto-completion gate failed")

    session = _mapping(report.get("session"), "session")
    profile = _mapping(report.get("profile"), "profile")
    attempt = _mapping(report.get("attempt"), "attempt")
    phase = _mapping(report.get("phase"), "phase")
    outcome = _mapping(report.get("outcome"), "outcome")

    session_id = _text(session.get("session_id"), "session.session_id")
    attempt_id = _text(attempt.get("attempt_id"), "attempt.attempt_id")
    source = {
        "kind": "mt5_prop_report",
        "report_schema_version": report["schema_version"],
        "session_id": session_id,
        "attempt_id": attempt_id,
        "session_revision": _revision(session.get("revision"), "session.revision"),
        "attempt_revision": _revision(attempt.get("revision"), "attempt.revision"),
        "profile_id": _text(profile.get("profile_id"), "profile.profile_id"),
        "profile_hash": _text(profile.get("profile_hash"), "profile.profile_hash"),
        "data_version": _text(attempt.get("data_version"), "attempt.data_version"),
        "cost_version": _text(attempt.get("cost_version"), "attempt.cost_version"),
        "engine_version": _text(attempt.get("engine_version"), "attempt.engine_version"),
    }
    reason_codes = outcome.get("reason_codes", [])
    if not isinstance(reason_codes, list) or not all(isinstance(item, str) and item for item in reason_codes):
        raise NotionProjectionError("outcome.reason_codes must contain non-empty strings")
    properties = {
        "mode": report["mode"],
        "result_source": _text(report.get("result_source"), "result_source"),
        "session_status": _text(session.get("status"), "session.status"),
        "attempt_status": _text(attempt.get("status"), "attempt.status"),
        "branch_kind": _text(attempt.get("branch_kind"), "attempt.branch_kind"),
        "phase_index": phase.get("phase_index"),
        "balance": phase.get("balance"),
        "floating_pl": phase.get("floating_pl"),
        "equity": phase.get("equity"),
        "high_water_mark": phase.get("high_water_mark"),
        "qualifying_days": phase.get("qualifying_days"),
        "evaluation_quality": _text(phase.get("evaluation_quality"), "phase.evaluation_quality"),
        "outcome_status": _text(outcome.get("status"), "outcome.status"),
        "terminal": outcome.get("terminal"),
        "terminal_action": outcome.get("terminal_action"),
        "reason_codes": list(reason_codes),
    }
    generated = {
        "title": f"MT5 prop report — {attempt_id}",
        "properties": properties,
        "breaches": _copy_breaches(outcome),
        "owner_notes_policy": {
            "preserve_existing": True,
            "managed_area": "generated.mt5_report",
            "user_notes_area": "owner_notes",
            "overwrite_scope": "managed_area_only",
        },
    }
    projection = {
        "schema_version": NOTION_PROJECTION_SCHEMA,
        "status": "PREP_ONLY",
        "source": source,
        "generated": generated,
        "safety": {
            "simulation_only": True,
            "broker_execution_capability": False,
            "broker_fields_excluded": True,
            "account_fields_excluded": True,
            "holdout_fields_excluded": True,
            "answer_keys_excluded": True,
        },
        "redaction": {
            "excluded_fields": ["broker", "account", "holdout", "credentials", "answer_keys"],
            "source_payload_policy": "allowlisted_fields_only",
        },
    }
    projection["integrity"] = {
        "source_fingerprint": _digest(source),
        "content_sha256": _digest(generated),
    }
    return projection


def _validate_request_id(value: Any) -> str:
    request_id = _text(value, "request_id")
    if len(request_id) > 128 or any(ord(char) < 0x20 for char in request_id):
        raise NotionProjectionError("request_id contains invalid characters")
    return request_id


def _validate_timestamp(value: Any) -> str:
    timestamp = _text(value, "requested_at_utc")
    if not _UTC_TIMESTAMP.fullmatch(timestamp):
        raise NotionProjectionError("requested_at_utc must be an explicit UTC timestamp")
    return timestamp


def build_notion_export_intent(
    projection: Mapping[str, Any],
    *,
    request_id: str,
    requested_at_utc: str,
    destination_ref: str | None = None,
    destination_selected: bool = False,
) -> dict[str, Any]:
    """Build a PREP_ONLY intent; no destination is contacted or mutated."""

    if not isinstance(projection, Mapping) or projection.get("schema_version") != NOTION_PROJECTION_SCHEMA:
        raise NotionProjectionError("projection schema is required")
    if projection.get("status") != "PREP_ONLY":
        raise NotionProjectionError("projection must remain PREP_ONLY")
    request_id = _validate_request_id(request_id)
    requested_at_utc = _validate_timestamp(requested_at_utc)
    if destination_selected != (destination_ref is not None):
        raise NotionProjectionError("destination selection must match destination_ref")
    if destination_ref is not None:
        _validate_request_id(destination_ref)

    source = projection.get("source")
    generated = projection.get("generated")
    if not isinstance(source, Mapping) or not isinstance(generated, Mapping):
        raise NotionProjectionError("projection source/generated sections are required")
    body = {
        "provider": "notion",
        "source": dict(source),
        "destination": {
            "kind": "page_or_database",
            "ref": destination_ref,
            "user_selected": destination_selected,
        },
        "payload": {
            "generated": dict(generated),
            "content_sha256": projection["integrity"]["content_sha256"],
        },
        "write_policy": {
            "preserve_existing_owner_notes": True,
            "managed_area": "generated.mt5_report",
            "external_id_required_before_dispatch": True,
        },
    }
    intent_fingerprint = _digest(body)
    return {
        "schema_version": NOTION_EXPORT_INTENT_SCHEMA,
        "status": "PREP_ONLY",
        "request_id": request_id,
        "requested_at_utc": requested_at_utc,
        **body,
        "receipt": {
            "schema_version": NOTION_RECEIPT_SCHEMA,
            "status": "pending",
            "outcome": "not_dispatched",
            "external_id": None,
            "source_revision": {
                "session": source["session_revision"],
                "attempt": source["attempt_revision"],
            },
            "intent_fingerprint": intent_fingerprint,
            "reconcile": "manual_on_unknown",
        },
        "intent_fingerprint": intent_fingerprint,
        "cloud_io": False,
    }


__all__ = [
    "NOTION_EXPORT_INTENT_SCHEMA",
    "NOTION_PROJECTION_SCHEMA",
    "NOTION_RECEIPT_SCHEMA",
    "NotionProjectionError",
    "build_notion_export_intent",
    "build_notion_projection",
]
