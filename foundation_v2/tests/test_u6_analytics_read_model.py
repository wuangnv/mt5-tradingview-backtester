from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(V2) not in sys.path:
    sys.path.insert(0, str(V2))

from trading_workspace_v2.analytics_read_model import (  # noqa: E402
    AnalyticsValidationError,
    analytics_csv,
    build_analytics_view,
    normalize_filters,
)


@pytest.mark.parametrize("net_pnl, expected", [
    (1e-13, "breakeven"), (-1e-13, "breakeven"),
    (1e-12, "breakeven"), (-1e-12, "breakeven"),
    (2e-12, "win"), (-2e-12, "loss"),
])
def test_outcome_filter_matches_metric_zero_tolerance(net_pnl, expected):
    result = result_fixture()
    result["ledger"] = [{**result["ledger"][0], "net_pnl": net_pnl}]
    for outcome in ("win", "loss", "breakeven"):
        view = build_analytics_view(result, {"outcome": outcome})
        assert len(view["ledger"]) == (1 if outcome == expected else 0)


def result_fixture() -> dict:
    return {
        "job_id": "job-u6",
        "workspace_id": "tenant-a",
        "dataset_id": "dataset-u6",
        "dataset_sha256": "dataset-sha",
        "protocol_sha256": "protocol-sha",
        "protocol": {"starting_balance": 1_000.0, "split": "baseline"},
        "playbook_id": "playbook-u6",
        "playbook_revision": 3,
        "split": "baseline",
        "created_at_utc": "2026-09-29T00:00:00Z",
        "ledger": [
            {
                "trade_id": "t1",
                "open_time_utc": 1_700_000_000,
                "close_time_utc": 1_700_000_060,
                "symbol": "EURUSD",
                "side": "BUY",
                "quantity": 1,
                "price_open": 1.1,
                "price_close": 1.2,
                "gross_pnl": 12,
                "fees": 2,
                "net_pnl": 10,
                "planned_risk_budget": 10,
                "realized_r": 1,
            },
            {
                "trade_id": "t2",
                "open_time_utc": 1_700_000_100,
                "close_time_utc": 1_700_000_160,
                "symbol": "EURUSD",
                "side": "SELL",
                "quantity": 1,
                "price_open": 1.2,
                "price_close": 1.3,
                "gross_pnl": -8,
                "fees": 2,
                "net_pnl": -10,
                "planned_risk_budget": 10,
                "realized_r": -1,
            },
        ],
    }


def test_filtered_view_recomputes_canonical_metrics_and_keeps_provenance():
    view = build_analytics_view(result_fixture(), {"side": "BUY", "outcome": "win"})

    assert view["analytics_available"] is True
    assert view["scope"]["selected_trade_count"] == 1
    assert view["scope"]["total_trade_count"] == 2
    assert view["metrics"]["metric_schema_version"] == "metrics-v2"
    assert view["metrics"]["net_pnl"] == 10
    assert view["metrics"]["closed_trade_count"] == 1
    assert view["provenance"]["dataset_sha256"] == "dataset-sha"
    assert view["provenance"]["protocol_sha256"] == "protocol-sha"
    assert view["filters"]["side"] == "buy"


def test_numeric_and_iso_utc_filters_have_the_same_boundary_semantics():
    result = result_fixture()
    numeric = build_analytics_view(result, {"from_close_utc": 1_700_000_060, "to_close_utc": 1_700_000_060})
    iso = build_analytics_view(
        result,
        {"from_close_utc": "2023-11-14T22:14:20Z", "to_close_utc": "2023-11-14T22:14:20+00:00"},
    )
    assert [row["trade_id"] for row in numeric["ledger"]] == ["t1"]
    assert [row["trade_id"] for row in iso["ledger"]] == ["t1"]


def test_missing_ledger_is_explicitly_blocked_and_does_not_fabricate_selection():
    result = result_fixture()
    result.pop("ledger")
    result["metrics"] = {"metric_schema_version": "metrics-v2", "closed_trade_count": 2}
    view = build_analytics_view(result, {"side": "BUY"})

    assert view["analytics_available"] is False
    assert view["blocked_by_data"] == ["closed_trade_ledger_missing"]
    assert view["scope"]["selected_trade_count"] is None
    assert view["ledger"] == []
    assert view["metrics"]["closed_trade_count"] == 2


def test_filter_validation_rejects_naive_or_reversed_ranges():
    with pytest.raises(AnalyticsValidationError, match="include a timezone"):
        normalize_filters({"from_close_utc": "2026-09-29T00:00:00"})
    with pytest.raises(AnalyticsValidationError, match="must not be after"):
        normalize_filters(
            {
                "from_close_utc": "2026-09-30T00:00:00Z",
                "to_close_utc": "2026-09-29T00:00:00Z",
            }
        )


def test_csv_export_contains_scope_metrics_and_formula_safe_ledger_values():
    result = result_fixture()
    result["ledger"][0]["legacy_result"] = "=HYPERLINK(\"https://example.invalid\")"
    csv_text = analytics_csv(build_analytics_view(result))

    assert "provenance,dataset_sha256,dataset-sha" in csv_text
    assert "metrics,metric_schema_version,metrics-v2" in csv_text
    assert "'=HYPERLINK" in csv_text
    assert "closed_trade_balance_curve" not in csv_text

