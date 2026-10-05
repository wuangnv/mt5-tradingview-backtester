"""Offline journeys using real immutable M1/tick artifacts and service contracts."""
from __future__ import annotations

import copy
import csv
import gzip
import hashlib
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "foundation_v2")]

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.data_ingest import DataIngestService
from trading_workspace_v2.prop_replay import (
    ReplayPropConnectionError, validate_replay_prop_binding, validate_replay_prop_branch_checkpoint,
)
from trading_workspace_v2.prop_session import ChallengeAttemptSnapshot, PhaseStateSnapshot
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_analytics import build_replay_analytics_view
from trading_workspace_v2.replay_execution import parse_replay_execution_snapshot
from trading_workspace_v2.tick_history import COLUMNS, TickHistoryStore

BASE = 1767225600
WORKSPACE = "tenant-tick"
SERVER = "offline-fixture-demo"
INSTRUMENT = {"instrument_id": "EURUSDm", "asset_class": "fx", "base_ccy": "EUR",
    "quote_ccy": "USD", "account_ccy": "USD", "tick_size": "0.0001", "pip_size": "0.0001",
    "contract_size": "100000", "quantity_min": "0.01", "quantity_step": "0.01",
    "effective_from_utc": "2026-01-01T00:00:00Z", "effective_to_utc": ""}
COSTS = {"version": "offline-tick-cost-v1", "spread_basis": "bid_ask_embedded",
    "commission_per_side_account": "1", "minimum_fee_account": "0", "slippage_price_per_side": "0",
    "financing_account": "0", "quote_to_account_rate": "1", "account_ccy": "USD", "rounding_decimals": 2}
MARGIN = {"version": "fixed-starting-balance-leverage-v1", "leverage": "100"}


class MemoryStore:
    """Storage fixture only; artifacts, normalization and replay are production code."""
    def __init__(self):
        self.datasets, self.records, self.revisions = {}, {}, {}

    def ensure_workspace(self, workspace):
        pass

    def get_dataset(self, workspace, dataset):
        return self.datasets.get((workspace, dataset))

    def put_dataset(self, manifest):
        self.datasets[(manifest.workspace_id, manifest.dataset_id)] = manifest

    def get_record(self, workspace, kind, identity):
        return copy.deepcopy(self.records.get((workspace, kind, identity)))

    def create_record(self, workspace, kind, payload):
        return self._create(workspace, kind, uuid4().hex, payload)

    def _create(self, workspace, kind, identity, payload):
        key = (workspace, kind, identity)
        record = {"record_id": identity, "workspace_id": workspace, "revision": 1,
            "payload": copy.deepcopy(payload), "created_at_utc": "2026-01-01T00:00:00Z",
            "updated_at_utc": "2026-01-01T00:00:00Z"}
        self.records[key] = record
        self.revisions[key] = [copy.deepcopy(record)]
        return copy.deepcopy(record)

    def update_record(self, workspace, kind, identity, revision, payload):
        key = (workspace, kind, identity)
        previous = self.records[key]
        if previous["revision"] != revision:
            raise RuntimeError("record revision conflict")
        record = {**previous, "revision": revision + 1, "payload": copy.deepcopy(payload)}
        self.records[key] = record
        self.revisions[key].append(copy.deepcopy(record))
        return copy.deepcopy(record)

    def list_record_revisions(self, workspace, kind, identity):
        return copy.deepcopy(self.revisions[(workspace, kind, identity)])

    def create_replay_branch_record(self, workspace, parent, revision, identity, payload):
        if self.records[(workspace, "replay", parent)]["revision"] != revision:
            raise RuntimeError("record revision conflict")
        return self._create(workspace, "replay", identity, payload)


def broker_row(minute, bid, ask, offset=0):
    return {"time_msc": (BASE + minute * 60) * 1000 + offset, "bid": bid, "ask": ask,
            "last": 0, "volume": 0, "flags": 6, "volume_real": 0}


def default_rows():
    return [broker_row(0, 1.1000, 1.1002, 500), broker_row(1, 1.1000, 1.1002),
            broker_row(1, 1.1022, 1.1024, 1), broker_row(1, 1.0980, 1.0982, 2),
            broker_row(2, 1.1000, 1.1002), broker_row(2, 1.0976, 1.0978, 1),
            broker_row(3, 1.1300, 1.1302)]


def capture(fixture, rows, *, requested_minutes=4, server=SERVER, symbol="EURUSDm", mode="demo"):
    directory = fixture.path / ("capture-" + uuid4().hex)
    directory.mkdir()
    raw = directory / "ticks.csv.gz"
    with gzip.open(raw, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    receipt = {"symbol": symbol, "provider": "mt5", "server": server, "account_key": "a" * 64,
        "mode": mode, "execution_capability": False, "requested_from_msc": BASE * 1000,
        "requested_to_msc": (BASE + requested_minutes * 60) * 1000, "tick_file": raw.name,
        "raw_sha256": hashlib.sha256(raw.read_bytes()).hexdigest(), "row_count": len(rows),
        "status": "downloaded", "metadata": {"instrument": INSTRUMENT}}
    path = directory / "receipt.json"
    path.write_text(json.dumps(receipt), encoding="utf-8")
    return fixture.ticks.ingest_capture(WORKSPACE, path)


@pytest.fixture
def product(tmp_path):
    store = MemoryStore()
    artifacts = ArtifactStore(tmp_path / "artifacts")
    bars = tmp_path / "bars.csv"
    bars.write_text("time,open,high,low,close\n" + "".join(
        f"{BASE + minute * 60},1.1000,1.1400,1.0800,1.1010\n" for minute in range(4)), encoding="utf-8")
    source = {"source_id": "offline-m1", "provider": SERVER + " / MT5",
        "instrument_mapping": {"EURUSDm": "EURUSDm"}, "license_use": "generated offline fixture",
        "retrieved_at_utc": "2026-01-01T00:00:00Z", "export_settings": "M1 UTC fixture"}
    manifest = DataIngestService(store, artifacts).import_csv(workspace_id=WORKSPACE, path=bars,
        source=source, instrument=INSTRUMENT, timeframe_seconds=60)
    fixture = SimpleNamespace(path=tmp_path, store=store, artifacts=artifacts, dataset=manifest,
                              ticks=TickHistoryStore(artifacts.root), service=ReplayService(store, artifacts))
    fixture.tick = capture(fixture, default_rows())
    fixture.record = fixture.service.create(WORKSPACE, manifest.dataset_id)
    return fixture


def initialize(fixture, *, tick_id=None):
    record = fixture.record
    fixture.record = fixture.service.initialize_execution(WORKSPACE, record["record_id"], record["revision"],
        instrument_spec=INSTRUMENT, cost_model=COSTS, spread_price="0", timeframe_seconds=60,
        starting_balance="100000", research_margin=MARGIN,
        tick_snapshot_id=tick_id or fixture.tick["snapshot_id"])
    return fixture.record


def test_missing_tick_store_rejects_selected_tick_without_ohlc_initialization(product):
    product.service.ticks = None
    with pytest.raises(ValueError, match='tick history storage is unavailable'):
        initialize(product)
    stored = product.store.get_record(WORKSPACE, 'replay', product.record['record_id'])
    assert stored['payload'].get('execution') is None


def queue(fixture, side="BUY"):
    record = fixture.record
    fixture.record = fixture.service.queue_market_order(WORKSPACE, record["record_id"], record["revision"],
        operation_id="operation-" + uuid4().hex, side=side, quantity="1",
        stop_loss="1.0990" if side == "BUY" else "1.1020",
        take_profit="1.1020" if side == "BUY" else "1.0980")
    return fixture.record


def step(fixture, steps=1):
    record = fixture.record
    fixture.record = fixture.service.step(WORKSPACE, record["record_id"], record["revision"], steps)
    return fixture.record


def test_init_is_closed_current_quote_and_order_fills_only_next_minute(product):
    record = initialize(product)
    state = record["payload"]["execution"]
    assert state["event_sequence"] == 1
    assert state["cursor_index"] == 0
    assert state["last_bid"] == "1.1"
    assert state["last_ask"] == "1.1002"
    assert state["ledger"][0]["virtual_time_utc"] == BASE + 60
    assert state["ledger"][0]["details"]["time_msc"] == BASE * 1000 + 500
    queued = queue(product)
    assert len(queued["payload"]["execution"]["ledger"]) == 1
    result = step(product)
    fill = result["execution_events"][0]
    assert fill["kind"] == "market_fill"
    assert fill["details"]["time_msc"] == (BASE + 60) * 1000
    assert fill["details"]["fill_price"] == "1.1002"
    assert result["execution_events"][1]["details"]["reason"] == "take_profit"


def test_buy_sell_tick_outcomes_feed_existing_trade_analytics(product):
    initialize(product)
    queue(product)
    step(product)
    queue(product, "SELL")
    record = step(product)
    analytics = build_replay_analytics_view(product.service.analytics_record(WORKSPACE, record["record_id"]))
    assert analytics["metrics"]["closed_trade_count"] == 2
    assert analytics["metrics"]["net_pnl"] == 416
    assert [row["side"] for row in analytics["ledger"]] == ["BUY", "SELL"]
    assert analytics["ledger"][0]["price_close"] == 1.1022
    assert analytics["ledger"][1]["price_close"] == 1.0978
    assert analytics["research_margin"]["leverage"] == "100"
    assert analytics["provenance"]["tick_snapshot_id"] == product.tick["snapshot_id"]
    assert analytics["provenance"]["quote_source"] == "broker_bid_ask"


def test_spread_can_trigger_stop_on_entry_tick_and_commission_is_counted_once(product):
    record = initialize(product)
    product.record = product.service.queue_market_order(WORKSPACE, record["record_id"], record["revision"],
        operation_id="same-tick-stop", side="BUY", quantity="1", stop_loss="1.1001", take_profit="1.1020")
    record = step(product)
    opening, closing = record["execution_events"][:2]
    assert closing["kind"] == "protective_fill"
    assert opening["details"]["time_msc"] == closing["details"]["time_msc"]
    assert closing["details"]["reason"] == "stop_loss"
    assert closing["details"]["fill_price"] == "1.1"
    analytics = build_replay_analytics_view(product.service.analytics_record(WORKSPACE, record["record_id"]))
    assert analytics["metrics"]["closed_trade_count"] == 1
    assert analytics["metrics"]["net_pnl"] == -22


def test_historical_quotes_analytics_and_branch_cannot_see_future(product):
    initialize(product)
    queue(product)
    first = copy.deepcopy(step(product))
    queue(product, "SELL")
    current = step(product)
    before = copy.deepcopy(product.store.records)
    historical = product.service.analytics_record(WORKSPACE, current["record_id"], cursor_index=1)
    assert historical["payload"]["execution"]["last_bid"] == first["payload"]["execution"]["last_bid"]
    analytics = build_replay_analytics_view(historical)
    assert analytics["metrics"]["closed_trade_count"] == 1
    assert analytics["metrics"]["net_pnl"] == 198
    assert product.store.records == before
    child = product.service.branch(WORKSPACE, current["record_id"], current["revision"], 0)
    state = child["payload"]["execution"]
    assert state["last_bid"] == "1.1"
    assert state["tick_snapshot_id"] == product.tick["snapshot_id"]
    assert state["ledger"][0]["replay_session_id"] == child["record_id"]
    assert child["payload"]["parent_session_id"] == current["record_id"]
    assert product.store.records[(WORKSPACE, "replay", current["record_id"])] == before[(WORKSPACE, "replay", current["record_id"])]


def test_branch_restores_quotes_from_ledger_when_bar_revision_is_not_retained(product):
    initialize(product)
    queue(product)
    first = step(product)
    first_bid = first["payload"]["execution"]["last_bid"]
    queue(product, "SELL")
    current = step(product)
    key = (WORKSPACE, "replay", current["record_id"])
    product.store.revisions[key] = [copy.deepcopy(product.store.records[key])]
    child = product.service.branch(WORKSPACE, current["record_id"], current["revision"], 1)
    assert child["payload"]["parent_checkpoint_source"] == "ledger_price_mark"
    assert child["payload"]["execution"]["last_bid"] == first_bid
    assert Decimal(child["payload"]["execution"]["balance"]) == 100198
    assert Decimal(product.store.records[key]["payload"]["execution"]["balance"]) == 100416


def test_empty_future_minute_does_not_commit_partial_multistep_execution(product):
    sparse = [row for row in default_rows() if not (BASE + 120) * 1000 <= row["time_msc"] < (BASE + 180) * 1000]
    pin = capture(product, sparse)
    initialize(product, tick_id=pin["snapshot_id"])
    queue(product)
    before = copy.deepcopy(product.store.records)
    revisions = copy.deepcopy(product.store.revisions)
    with pytest.raises(ValueError, match="empty"):
        step(product, 2)
    assert product.store.records == before
    assert product.store.revisions == revisions


def test_requested_interval_missing_future_minutes_fails_without_revision_change(product):
    # Replace one UTC partition with a dedicated store to represent a short capture.
    product.ticks = TickHistoryStore(product.path / "short-ticks")
    short = capture(product, [default_rows()[0]], requested_minutes=1)
    product.service.ticks = product.ticks
    initialize(product, tick_id=short["snapshot_id"])
    queue(product)
    before = copy.deepcopy(product.store.records)
    with pytest.raises(ValueError, match="not downloaded"):
        step(product)
    assert product.store.records == before


def test_refresh_changes_latest_only_and_original_session_keeps_original_tick_outcome(product):
    initialize(product)
    pin = product.record["payload"]["execution"]["tick_snapshot_id"]
    rows = default_rows()
    rows[2] = broker_row(1, 1.0980, 1.0982, 1)
    latest = capture(product, rows)
    assert latest["snapshot_id"] != pin
    assert product.ticks.latest(WORKSPACE, "EURUSDm")["snapshot_id"] == latest["snapshot_id"]
    queue(product)
    record = step(product)
    assert record["payload"]["execution"]["tick_snapshot_id"] == pin
    assert record["execution_events"][1]["details"]["reason"] == "take_profit"
    assert Decimal(record["payload"]["execution"]["balance"]) == 100198
    assert product.ticks.load_manifest(WORKSPACE, pin)["snapshot_id"] == pin


def test_tick_init_rejects_foreign_tenant_atomically(product):
    before = copy.deepcopy(product.store.records)
    with pytest.raises(LookupError, match="not found"):
        product.service.initialize_execution("foreign-tenant", product.record["record_id"], 1,
            instrument_spec=INSTRUMENT, cost_model=COSTS, spread_price="0", timeframe_seconds=60,
            starting_balance="100000", research_margin=MARGIN, tick_snapshot_id=product.tick["snapshot_id"])
    assert product.store.records == before


@pytest.mark.parametrize("change", [{"research_margin": None}, {"spread_price": "0.0002"}])
def test_tick_init_requires_explicit_margin_and_embedded_spread_only(product, change):
    before = copy.deepcopy(product.store.records)
    arguments = dict(instrument_spec=INSTRUMENT, cost_model=COSTS, spread_price="0", timeframe_seconds=60,
        starting_balance="100000", research_margin=MARGIN, tick_snapshot_id=product.tick["snapshot_id"])
    arguments.update(change)
    with pytest.raises(ValueError):
        product.service.initialize_execution(WORKSPACE, product.record["record_id"], 1, **arguments)
    assert product.store.records == before


@pytest.mark.parametrize("source_change", [{"server": "different-demo"}, {"symbol": "GBPUSDm"}])
def test_foreign_tick_server_or_symbol_cannot_bind_dataset(product, source_change):
    product.ticks = TickHistoryStore(product.path / "foreign-ticks")
    foreign = capture(product, default_rows(), **source_change)
    product.service.ticks = product.ticks
    before = copy.deepcopy(product.store.records)
    with pytest.raises(ValueError, match="source does not match"):
        initialize(product, tick_id=foreign["snapshot_id"])
    assert product.store.records == before


def test_service_pending_protection_uses_observed_quote_then_survives_parse(product):
    initialize(product)
    record = queue(product)
    operation = record["payload"]["execution"]["pending_market_order"]["operation_id"]
    product.record = product.service.change_protection(WORKSPACE, record["record_id"], record["revision"],
        target_id=operation, operation_id="amend-test", stop_loss="1.0995", take_profit="1.1025")
    state = product.record["payload"]["execution"]
    parse_replay_execution_snapshot(state)
    assert state["ledger"][-1]["details"]["closeable_quote"] == "1.1"
    assert state["ledger"][-1]["details"]["tick_snapshot_id"] == product.tick["snapshot_id"]
    assert state["pending_market_order"]["stop_loss"] == "1.0995"


def test_prop_requires_tick_engine_and_frozen_dataset_cost_pins(product):
    record = initialize(product)
    snapshot = parse_replay_execution_snapshot(record["payload"]["execution"])
    now = datetime.fromtimestamp(BASE, timezone.utc)
    attempt = ChallengeAttemptSnapshot(workspace_id=WORKSPACE, session_id="prop-session", attempt_id="attempt",
        profile_id="fixture", terms_version="v1", profile_hash="b" * 64,
        data_version="sha256:" + snapshot.dataset_sha256, cost_version=COSTS["version"],
        engine_version="replay-tick-v1", virtual_start_utc=now, virtual_cutoff_utc=now)
    phase = PhaseStateSnapshot(workspace_id=WORKSPACE, session_id="prop-session", attempt_id="attempt",
        profile_hash="b" * 64, phase_index=1, initial_balance="100000", balance="100000",
        floating_pl="0", equity="100000", high_water_mark="100000", daily_anchor="100000",
        virtual_time_utc=now, evaluation_quality="full_for_declared_model")
    validate_replay_prop_binding(snapshot, attempt, phase)
    for change in ({"engine_version": "replay-v2"}, {"data_version": "c" * 64}, {"cost_version": "other"}):
        with pytest.raises(ReplayPropConnectionError):
            validate_replay_prop_binding(snapshot, attempt.model_copy(update=change), phase)
    child = product.service.branch(WORKSPACE, record["record_id"], record["revision"], 0)
    child_snapshot = parse_replay_execution_snapshot(child["payload"]["execution"])
    checkpoint_time = datetime.fromtimestamp(BASE + 60, timezone.utc)
    phase = phase.model_copy(update={"virtual_time_utc": checkpoint_time})
    resume = {"replay_binding": {"replay_session_id": snapshot.replay_session_id,
        "branch_id": snapshot.branch_id, "dataset_id": snapshot.dataset_id,
        "dataset_sha256": snapshot.dataset_sha256, "last_replay_event_sequence": 1},
        "cursor": {"bar_index": 0, "timestamp_utc": checkpoint_time.isoformat()},
        "open_positions": [], "pending_orders": []}
    args = dict(child_payload=child["payload"], parent_snapshot=snapshot,
                historical_attempt=attempt, phase=phase, resume_state=resume)
    validate_replay_prop_branch_checkpoint(child_snapshot, **args)
    for field, wrong in (("tick_snapshot_id", "ticks-" + "c" * 64), ("tick_snapshot_sha256", "c" * 64)):
        with pytest.raises(ReplayPropConnectionError, match="immutable execution pins"):
            validate_replay_prop_branch_checkpoint(child_snapshot.model_copy(update={field: wrong}), **args)
