from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import sys

import pytest

# Keep this test runnable both from the foundation project and from the
# workspace root, matching the existing foundation_v2 test import convention.
FOUNDATION_ROOT = Path(__file__).resolve().parents[1]
if str(FOUNDATION_ROOT) not in sys.path:
    sys.path.insert(0, str(FOUNDATION_ROOT))

from trading_workspace_v2.notion_projection import (
    NOTION_EXPORT_INTENT_SCHEMA,
    NOTION_PROJECTION_SCHEMA,
    NotionProjectionError,
    build_notion_export_intent,
    build_notion_projection,
)


def report_fixture() -> dict:
    return {
        "schema_version": "prop-attempt-report-v1",
        "mode": "simulation",
        "result_source": "simulation",
        "broker_execution_capability": False,
        "session": {
            "session_id": "session-001",
            "session_type": "prop",
            "status": "failed_breach",
            "revision": 4,
        },
        "profile": {
            "profile_id": "ps03-generic",
            "terms_version": "2026-09-26",
            "profile_hash": "sha256:profile-001",
            "source_kind": "fixture",
        },
        "attempt": {
            "attempt_id": "attempt-001",
            "status": "failed_breach",
            "revision": 7,
            "branch_kind": "clean",
            "data_version": "dataset:ps03",
            "cost_version": "cost-v1",
            "engine_version": "replay-v1",
        },
        "phase": {
            "phase_index": 1,
            "balance": "100500",
            "floating_pl": "-6000",
            "equity": "94500",
            "high_water_mark": "101000",
            "qualifying_days": 2,
            "evaluation_quality": "full_for_declared_model",
        },
        "outcome": {
            "status": "failed_breach",
            "terminal": True,
            "terminal_action": "breach",
            "reason_codes": ["daily_loss_breached"],
            "breaches": [
                {"rule": "daily_loss", "current": None, "floor": "95000", "reference": None}
            ],
        },
        "safety": {
            "simulation_only": True,
            "broker_results_included": False,
            "broker_credentials_included": False,
            "holdout_content_included": False,
        },
        "tutorials": {"answer_keys_exposed": False, "auto_completion_enabled": False},
    }


def test_projection_is_allowlisted_and_preserves_owner_notes_boundary() -> None:
    projection = build_notion_projection(report_fixture())

    assert projection["schema_version"] == NOTION_PROJECTION_SCHEMA
    assert projection["status"] == "PREP_ONLY"
    assert projection["source"]["attempt_revision"] == 7
    assert projection["generated"]["properties"]["equity"] == "94500"
    assert projection["generated"]["breaches"] == [
        {"rule": "daily_loss", "current": None, "floor": "95000", "reference": None}
    ]
    assert projection["generated"]["owner_notes_policy"] == {
        "preserve_existing": True,
        "managed_area": "generated.mt5_report",
        "user_notes_area": "owner_notes",
        "overwrite_scope": "managed_area_only",
    }
    assert projection["safety"]["broker_fields_excluded"] is True
    assert projection["safety"]["account_fields_excluded"] is True
    assert projection["safety"]["holdout_fields_excluded"] is True
    assert "objectives" not in projection["generated"]
    assert "broker" not in str(projection["generated"]).casefold()


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("session", "account_id"), "account-001"),
        (("profile", "holdout_policy"), {"mode": "metadata_only", "from_utc": 1}),
        (("attempt", "broker_server"), "Exness-MT5Trial14"),
        (("safety", "broker_credentials_included"), True),
    ],
)
def test_projection_fails_closed_on_account_broker_holdout_or_unsafe_flags(path, value) -> None:
    report = report_fixture()
    cursor = report
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = value

    with pytest.raises(NotionProjectionError):
        build_notion_projection(report)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("phase", "balance"), {"nested": "100500"}),
        (("phase", "equity"), ["94500"]),
        (("phase", "qualifying_days"), True),
        (("phase", "floating_pl"), float("nan")),
        (("outcome", "terminal"), "true"),
        (
            ("outcome", "breaches"),
            [{"rule": "daily_loss", "current": {"nested": "secret"}, "floor": "95000", "reference": None}],
        ),
        (
            ("outcome", "breaches"),
            [{"rule": "daily_loss", "current": None, "floor": "95000", "reference": None, "extra": "ignored"}],
        ),
    ],
)
def test_projection_rejects_nested_or_non_numeric_metric_values(path, value) -> None:
    report = report_fixture()
    cursor = report
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = value

    with pytest.raises(NotionProjectionError):
        build_notion_projection(report)


def test_export_intent_is_prep_only_until_destination_is_user_selected() -> None:
    projection = build_notion_projection(report_fixture())
    intent = build_notion_export_intent(
        projection,
        request_id="mt5-notion-req-001",
        requested_at_utc="2026-09-29T10:00:00Z",
    )

    assert intent["schema_version"] == NOTION_EXPORT_INTENT_SCHEMA
    assert intent["status"] == "PREP_ONLY"
    assert intent["cloud_io"] is False
    assert intent["destination"] == {
        "kind": "page_or_database",
        "ref": None,
        "user_selected": False,
    }
    assert intent["receipt"]["status"] == "pending"
    assert intent["receipt"]["outcome"] == "not_dispatched"
    assert intent["receipt"]["external_id"] is None
    assert intent["receipt"]["intent_fingerprint"] == intent["intent_fingerprint"]
    assert intent["write_policy"]["preserve_existing_owner_notes"] is True

    selected = build_notion_export_intent(
        projection,
        request_id="mt5-notion-req-001",
        requested_at_utc="2026-09-29T10:00:00Z",
        destination_ref="user-selected:notion-page-001",
        destination_selected=True,
    )
    assert selected["destination"]["user_selected"] is True
    assert selected["destination"]["ref"] == "user-selected:notion-page-001"


@pytest.mark.parametrize("destination_ref", ["guessed page", "/tmp/page", "x" * 257])
def test_export_intent_rejects_implicit_or_malformed_destination(destination_ref) -> None:
    projection = build_notion_projection(report_fixture())

    with pytest.raises(NotionProjectionError, match="destination_ref"):
        build_notion_export_intent(
            projection,
            request_id="req-001",
            requested_at_utc="2026-09-29T10:00:00Z",
            destination_ref=destination_ref,
            destination_selected=True,
        )


def test_export_intent_rejects_implicit_selection_and_invalid_time_or_flags() -> None:
    projection = build_notion_projection(report_fixture())

    with pytest.raises(NotionProjectionError, match="destination selection"):
        build_notion_export_intent(
            projection,
            request_id="req-001",
            requested_at_utc="2026-09-29T10:00:00Z",
            destination_ref="guessed-page",
        )
    with pytest.raises(NotionProjectionError, match="UTC timestamp"):
        build_notion_export_intent(
            projection,
            request_id="req-001",
            requested_at_utc="2026-02-30T10:00:00Z",
        )
    with pytest.raises(NotionProjectionError, match="destination_selected"):
        build_notion_export_intent(
            projection,
            request_id="req-001",
            requested_at_utc="2026-09-29T10:00:00Z",
            destination_selected=1,
        )


def test_export_intent_rejects_tampered_projection_integrity_or_payload() -> None:
    projection = build_notion_projection(report_fixture())

    tampered_content = deepcopy(projection)
    tampered_content["generated"]["properties"]["equity"] = "1"
    with pytest.raises(NotionProjectionError, match="content hash"):
        build_notion_export_intent(
            tampered_content,
            request_id="req-001",
            requested_at_utc="2026-09-29T10:00:00Z",
        )

    tampered_source = deepcopy(projection)
    tampered_source["source"]["attempt_revision"] = 99
    with pytest.raises(NotionProjectionError, match="source fingerprint"):
        build_notion_export_intent(
            tampered_source,
            request_id="req-001",
            requested_at_utc="2026-09-29T10:00:00Z",
        )

    tampered_hash = deepcopy(projection)
    tampered_hash["integrity"]["content_sha256"] = "sha256:" + "0" * 64
    with pytest.raises(NotionProjectionError, match="content hash"):
        build_notion_export_intent(
            tampered_hash,
            request_id="req-001",
            requested_at_utc="2026-09-29T10:00:00Z",
        )


def test_export_intent_rejects_non_opaque_request_id() -> None:
    projection = build_notion_projection(report_fixture())
    with pytest.raises(NotionProjectionError, match="opaque identifier"):
        build_notion_export_intent(
            projection,
            request_id="request with spaces",
            requested_at_utc="2026-09-29T10:00:00Z",
        )


def test_projection_fingerprint_is_stable_and_source_revision_changes_it() -> None:
    first = build_notion_projection(report_fixture())
    second = build_notion_projection(deepcopy(report_fixture()))
    assert first["integrity"] == second["integrity"]

    changed = report_fixture()
    changed["attempt"]["revision"] = 8
    third = build_notion_projection(changed)
    assert third["integrity"]["source_fingerprint"] != first["integrity"]["source_fingerprint"]
    assert third["integrity"]["content_sha256"] == first["integrity"]["content_sha256"]
