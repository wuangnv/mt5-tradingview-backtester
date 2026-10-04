from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace

import pytest

from test_replay_analytics import AnalyticsStore, record, phase_transition_record
from test_replay_execution_core import initial_state
from trading_workspace_v2.analytics_experiments import build_replay_experiments
from trading_workspace_v2.analytics_read_model import AnalyticsValidationError
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_execution import advance_replay_execution, queue_market_order


def exposure(*, side="BUY", ambiguous=False, gap=False):
    bars = [{"timestamp": 1699999940, "open": 1.1, "high": 1.1, "low": 1.1, "close": 1.1},
            {"timestamp": 1700000000, "open": 1.1, "high": 1.101, "low": 1.0998, "close": 1.1},
            {"timestamp": 1700000060, "open": 1.1, "high": 1.105 if ambiguous else 1.103,
             "low": 1.098 if ambiguous else 1.099, "close": 1.101},
            {"timestamp": 1700000120, "open": 1.121 if gap else 1.101,
             "high": 1.2, "low": 1.1, "close": 1.12}]
    if side == "SELL":
        def mirror(value):
            return float(Decimal("2.2") - Decimal(str(value)))
        bars = [{**bar, "open": mirror(bar["open"]), "high": mirror(bar["low"]),
                 "low": mirror(bar["high"]), "close": mirror(bar["close"])} for bar in bars]
    queued = queue_market_order(initial_state(), operation_id="entry", side=side, quantity="0.10",
                                stop_loss="1.09" if side == "BUY" else "1.11",
                                take_profit="1.12" if side == "BUY" else "1.08")
    for cursor, bar in enumerate(bars[1:], 1):
        queued = advance_replay_execution(queued, bar=bar, cursor_index=cursor).snapshot
    return record(queued), bars


def evaluate(source, bars, **kwargs):
    return build_replay_experiments(source, bars, dataset_sha256="d" * 64, **kwargs)


@pytest.mark.parametrize("side", ["BUY", "SELL"])
def test_costed_alternative_exit_and_lower_bound_exclude_post_exit_extrema(side):
    source, bars = exposure(side=side)
    before = deepcopy(source)
    result = evaluate(source, bars, target_r=1)
    row = result["rows"][0]
    assert row["risk_reward"]["status"] == "ready"
    assert row["risk_reward"]["exit_cursor_index"] == 2
    assert row["risk_reward"]["net_pnl"] == pytest.approx(18)
    assert row["risk_reward"]["gross_pnl"] == pytest.approx(20)
    assert row["stop_loss"]["net_pnl"] == pytest.approx(197)
    assert row["stop_loss"]["target_price"] is None
    assert row["excursion"]["status"] == "lower_bound"
    assert row["excursion"]["mae_price"] == pytest.approx(.0012)
    assert row["excursion"]["mfe_price"] == pytest.approx(.0199)
    assert row["excursion"]["mae_r"] == pytest.approx(.6)
    assert row["excursion"]["ideal_r"] is None
    assert source == before
    assert source["payload"]["execution"]["ledger"][-2]["details"].get("gross_pnl") is None


def test_stop_distance_multiplier_controls_actual_costed_stop_exit():
    source, bars = exposure()
    result = evaluate(source, bars, stop_multiplier=.5)
    row = result["rows"][0]
    assert row["stop_loss"]["exit_cursor_index"] == 2
    assert row["stop_loss"]["reason"] == "stop_loss"
    assert row["stop_loss"]["exit_price"] == pytest.approx(1.0991)
    assert row["stop_loss"]["net_pnl"] == pytest.approx(-12)


def test_ambiguous_paths_never_pick_arbitrary_winner_and_totals_remain_unknown():
    source, bars = exposure(ambiguous=True)
    result = evaluate(source, bars)
    assert result["rows"][0]["risk_reward"]["status"] == "ambiguous"
    assert result["rows"][0]["risk_reward"]["net_pnl"] is None
    assert result["summary"]["risk_reward"]["ambiguous_trade_count"] == 1
    assert result["summary"]["risk_reward"]["net_pnl"] is None
    assert result["rows"][0]["stop_loss"]["net_pnl"] == pytest.approx(-22)


def test_terminal_intrabar_crossing_cannot_be_used_as_alternative_exit():
    source, bars = exposure()
    result = evaluate(source, bars)
    assert result["rows"][0]["risk_reward"]["status"] == "unsupported"
    assert result["rows"][0]["risk_reward"]["reason"] == "original_exit_precedes_unknown_terminal_extrema"
    bars[-1]["high"] = 1.9
    assert evaluate(source, bars)["rows"][0]["excursion"] == result["rows"][0]["excursion"]


def test_gap_close_observes_only_open_and_ignores_later_terminal_range():
    source, bars = exposure(gap=True)
    result = evaluate(source, bars, target_r=50)
    row = result["rows"][0]
    assert row["excursion"]["status"] == "observed"
    assert row["excursion"]["mfe_price"] == pytest.approx(.0208)
    assert row["risk_reward"]["reason"] == "original_close"
    assert row["risk_reward"]["net_pnl"] == pytest.approx(197)


@pytest.mark.parametrize("config", [{"target_r": float("nan")}, {"target_r": 0},
                                    {"stop_distance_ticks": -2}, {"stop_multiplier": 101}])
def test_invalid_configuration_is_rejected(config):
    source, bars = exposure()
    with pytest.raises(AnalyticsValidationError):
        evaluate(source, bars, **config)


def test_dataset_identity_missing_path_and_entry_quote_are_not_fabricated():
    source, bars = exposure()
    with pytest.raises(AnalyticsValidationError, match="hash"):
        build_replay_experiments(source, bars, dataset_sha256="foreign")
    with pytest.raises(AnalyticsValidationError, match="outside"):
        evaluate(source, bars[:2])
    bars[1]["open"] = 1.1002
    result = evaluate(source, bars)
    assert result["rows"][0]["risk_reward"]["reason"] == "entry_quote_mismatch"


def test_historical_cutoff_and_filters_use_existing_read_only_analytics_contract(monkeypatch):
    store = AnalyticsStore()
    service = ReplayService(store, None)
    bars = [{"timestamp": 1699999940, "open": 1.1, "high": 1.1, "low": 1.1, "close": 1.1},
            {"timestamp": 1700000000, "open": 1.1, "high": 1.103, "low": 1.099, "close": 1.102},
            {"timestamp": 1700000060, "open": 1.1, "high": 1.103, "low": 1.099, "close": 1.102}]
    monkeypatch.setattr(service, "_dataset_rows", lambda *_: (SimpleNamespace(artifact_sha256="d" * 64), bars))
    before = deepcopy(store.current)
    historical = service.analytics_experiments("tenant-a", "replay-fixture", cutoff_timestamp=1700000000)
    assert len(historical["rows"]) == 1
    assert historical["provenance"]["historical_view"] is True
    assert service.analytics_experiments("tenant-a", "replay-fixture", filters={"side": "SELL"})["rows"] == []
    assert len(service.analytics_experiments("tenant-a", "replay-fixture")["rows"]) == 2
    assert store.current == before
    with pytest.raises(LookupError):
        service.analytics_experiments("tenant-b", "replay-fixture")
    with pytest.raises(ValueError):
        service.analytics_experiments("tenant-a", "replay-fixture", cursor_index=2, cutoff_timestamp=1700000000)


def test_uninitialized_execution_reports_blocked_data():
    result = evaluate(record(), [])
    assert result["rows"] == []
    assert result["blocked_by_data"] == ["replay_execution_not_initialized"]


def test_future_bars_are_not_consulted_even_when_their_values_are_invalid():
    source, bars = exposure()
    before = evaluate(source, bars)
    assert evaluate(source, [*bars, {"timestamp": 1800000000, "high": "future secret"}]) == before


@pytest.mark.parametrize("mutation", ["commission", "version", "currency"])
def test_corrupt_pinned_costs_do_not_create_plausible_financial_results(mutation):
    source, bars = exposure()
    costs = source["payload"]["execution"]["cost_model"]
    if mutation == "currency":
        costs["account_ccy"] = "EUR"
        with pytest.raises(AnalyticsValidationError, match="currency"):
            evaluate(source, bars)
    else:
        costs["commission_per_side_account" if mutation == "commission" else "version"] = "2" if mutation == "commission" else "foreign-model"
        result = evaluate(source, bars)
        assert result["rows"][0]["stop_loss"]["reason"] == "original_cost_model_mismatch"
        assert result["rows"][0]["risk_reward"]["net_pnl"] is None
        assert result["summary"]["stop_loss"]["net_pnl"] is None


def test_experiments_honor_exact_same_cursor_event_cutoff(monkeypatch):
    store = AnalyticsStore()
    store.current = phase_transition_record()
    service = ReplayService(store, None)
    bars = [{"timestamp": 1699999940, "open": 1.1, "high": 1.1, "low": 1.1, "close": 1.1},
            {"timestamp": 1700000000, "open": 1.1, "high": 1.103, "low": 1.099, "close": 1.102}]
    monkeypatch.setattr(service, "_dataset_rows", lambda *_: (SimpleNamespace(artifact_sha256="d" * 64), bars))
    result = service.analytics_experiments("tenant-a", "replay-fixture", cursor_index=1, event_sequence=3)
    assert result["provenance"]["execution_event_sequence"] == 3
    assert result["provenance"]["phase_index"] == 1
    assert result["provenance"]["phase_initial_balance"] == 100000


def test_readonly_http_route_validates_scope_config_and_history_without_database(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from trading_workspace_v2 import api
    from trading_workspace_v2.auth import LocalWorkspaceAuthorization

    class FakeStore(AnalyticsStore):
        def __init__(self, _dsn):
            super().__init__()

        def initialize(self):
            pass

    monkeypatch.setattr(api, "PostgresStore", FakeStore)
    app = api.create_app(dsn="not-used", artifact_root=tmp_path, learn_roots={},
                         authorization=LocalWorkspaceAuthorization.for_local_owner(["tenant-a"]))
    bars = [{"timestamp": 1699999940, "open": 1.1, "high": 1.1, "low": 1.1, "close": 1.1},
            {"timestamp": 1700000000, "open": 1.1, "high": 1.103, "low": 1.099, "close": 1.102},
            {"timestamp": 1700000060, "open": 1.1, "high": 1.103, "low": 1.099, "close": 1.102}]
    monkeypatch.setattr(app.state.replay, "_dataset_rows",
                        lambda *_: (SimpleNamespace(artifact_sha256="d" * 64), bars))
    before = deepcopy(app.state.store.current)
    path = "/api/v2/replay/sessions/replay-fixture/analytics/experiments"
    with TestClient(app) as client:
        headers = {"X-Workspace-Id": "tenant-a"}
        response = client.get(path, params={"cursor_index": 1, "stop_distance_ticks": 25}, headers=headers)
        assert response.status_code == 200
        assert response.json()["read_only"] is True
        assert response.json()["config"]["stop_distance_ticks"] == 25
        assert len(response.json()["rows"]) == 1
        exact = client.get(path, params={"cursor_index": 1, "event_sequence": 3}, headers=headers)
        assert exact.status_code == 200
        assert exact.json()["provenance"]["execution_event_sequence"] == 3
        for suffix in ("analytics", "analytics.csv"):
            read = client.get(path.replace("analytics/experiments", suffix),
                              params={"cursor_index": 1, "event_sequence": 3}, headers=headers)
            assert read.status_code == 200
        assert client.get(path, params={"cursor_index": 3}, headers=headers).status_code == 422
        assert client.get(path, params={"target_r": "nan"}, headers=headers).status_code == 422
        assert client.get(path, params={"side": "bad"}, headers=headers).status_code == 422
        assert client.get(path, headers={"X-Workspace-Id": "tenant-b"}).status_code == 403
        assert client.get(path.replace("replay-fixture", "missing"), headers=headers).status_code == 404
        assert client.post(path, headers=headers).status_code == 405
    assert app.state.store.current == before
