"""Bounded offline API probe; does not implement or accept crash resume."""

from __future__ import annotations

import hashlib
import json
import pickle
import platform
import socket
import sys
import time
from pathlib import Path


FOUNDATION = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FOUNDATION / "engine_runtime"))


def deny_network(*args, **kwargs):
    raise RuntimeError("Python socket connection denied by offline probe")


socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network

import adapter
import nautilus_trader
import pyarrow
from nautilus_trader.backtest import engine as native_engine_module
from nautilus_trader.backtest.engine import OrderMatchingEngine
from nautilus_trader.cache import cache as native_cache_module


def digest(value):
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def serialization_probe(value):
    try:
        data = pickle.dumps(value, protocol=5)
        restored = pickle.loads(data)
        result = {"success": True, "bytes": len(data), "restored_type": type(restored).__name__}
        if hasattr(restored, "get"):
            general_value = restored.get("resume-probe")
            result["general_value"] = general_value.decode() if general_value else None
        return result
    except Exception as exc:
        return {"success": False, "type": type(exc).__name__, "message": str(exc), "repr": repr(exc)}


def main():
    started = time.perf_counter()
    prices = [
        (9.8, 9.95, 9.7, 9.9),
        (9.9, 10.1, 9.85, 10),
        (10, 10.25, 9.95, 10.2),
        (10.03, 10.3, 10, 10.21),
        (10.21, 10.3, 10, 10.21),
        (10.21, 10.55, 10.2, 10.5),
        (10.5, 10.6, 10.35, 10.4),
        (10.4, 10.5, 10.3, 10.4),
        (10.4, 10.5, 10.3, 10.4),
    ]
    rows = [
        {"timestamp": index * 3600, "open": o, "high": h, "low": low, "close": c, "volume": 100}
        for index, (o, h, low, c) in enumerate(prices)
    ]
    protocol = {
        "dataset": {
            "instrument_spec": {
                "asset_class": "fx", "account_ccy": "USD", "quote_ccy": "USD", "base_ccy": "EUR",
                "instrument_id": "RESUMEAUDIT", "tick_size": "0.05", "contract_size": "1000",
                "quantity_step": "0.01", "quantity_min": "0.01",
            },
            "timeframe_seconds": 3600,
        },
        "playbook": {"rules": {"lookback": 2, "hold_bars": 1, "quantity": 0.03, "direction": "long"}},
        "range": {"from_utc": 0, "to_utc": 32400},
        "starting_balance": 10000,
        "parameters": {"spread_price": "0.02"},
    }
    result = {
        "schema": "u5a-native-resume-primitive-probe-v1",
        "runtime": {"python": platform.python_version(), "pyarrow": pyarrow.__version__,
                    "nautilus": nautilus_trader.__version__, "platform": platform.platform()},
        "effects": {
            "input": "nine synthetic bars, eighteen modeled quote events, no real dataset or holdout",
            "python_socket_connections": "connect/connect_ex/create_connection denied before native import",
            "database": "no cache/message-bus database or external client configured",
            "product_source_or_config_writes": False,
            "pickle": "only objects generated in this probe; no externally supplied pickle input",
            "network_limit": "Python socket denial is not a C-extension network sandbox",
        },
        "fixture_sha256": digest({"rows": rows, "protocol": protocol}),
    }
    original_engine = adapter.BacktestEngine
    empty = original_engine(config=adapter.BacktestEngineConfig(
        logging=adapter.LoggingConfig(bypass_logging=True), run_analysis=False))
    try:
        result["engine_public_persistence_methods"] = [
            name for name in dir(empty) if any(part in name.lower() for part in ("save", "load", "dump", "snapshot"))
        ]
        result["matching_engine_public_restore_methods"] = [
            name for name in dir(OrderMatchingEngine)
            if any(part in name.lower() for part in ("save", "load", "dump", "snapshot", "restore"))
            or name.endswith("_count")
        ]
        result["empty_serialization"] = {
            "engine": serialization_probe(empty), "kernel": serialization_probe(empty.kernel),
            "cache": serialization_probe(empty.cache),
        }
        empty.cache.add("resume-probe", b"offline-only")
        result["cache_general_roundtrip"] = serialization_probe(empty.cache)
        result["empty_dump_pickled_data"] = {
            "decoded_type": type(pickle.loads(empty.dump_pickled_data())).__name__,
            "decoded_length": len(pickle.loads(empty.dump_pickled_data())),
        }
    finally:
        empty.dispose()

    uninterrupted = adapter.execute_nautilus(rows, protocol)

    class StreamingProbeEngine:
        def __init__(self, **kwargs):
            self.native = original_engine(**kwargs)

        def __getattr__(self, name):
            return getattr(self.native, name)

        def add_strategy(self, strategy):
            self.strategy = strategy
            self.native.add_strategy(strategy)

        def add_data(self, data):
            self.data = data

        def run(self):
            self.native.add_data(self.data[:8])
            self.native.run(streaming=True)
            strategy = self.strategy
            prefix = {
                "processed_engine_events": self.native.iteration,
                "last_timestamp_ns": int(self.data[7].ts_event),
                "fills": len(strategy.fills), "signals": dict(strategy.signals),
                "pending": strategy.pending, "active_side": strategy.active_side,
                "open_orders": len(self.native.cache.orders_open()),
                "inflight_orders": len(self.native.cache.orders_inflight()),
                "open_positions": len(self.native.cache.positions_open()),
                "client_order_count": strategy.order_factory.get_client_order_id_count(),
                "order_list_count": strategy.order_factory.get_order_list_id_count(),
                "strategy_save": strategy.save(), "clock_timer_count": strategy.clock.timer_count,
                "native_balances": [
                    {"total": str(balance.total), "free": str(balance.free), "locked": str(balance.locked)}
                    for account in self.native.cache.accounts() for balance in account.balances().values()
                ],
                "dump_pickled_data_decoded_length": len(pickle.loads(self.native.dump_pickled_data())),
            }
            result["prefix"] = prefix
            result["prefix_serialization"] = {
                "engine": serialization_probe(self.native),
                "kernel": serialization_probe(self.native.kernel),
                "cache": serialization_probe(self.native.cache),
            }
            assert prefix["processed_engine_events"] == 8
            assert prefix["fills"] == 2 and prefix["pending"] is None and prefix["active_side"] is None
            assert prefix["open_orders"] == prefix["inflight_orders"] == prefix["open_positions"] == 0
            assert prefix["clock_timer_count"] == 0 and prefix["strategy_save"] == {}
            assert not result["prefix_serialization"]["engine"]["success"]
            assert not result["prefix_serialization"]["cache"]["success"]
            self.native.clear_data()
            self.native.add_data(self.data[8:])
            self.native.run(streaming=True)
            result["suffix"] = {
                "total_engine_events": self.native.iteration,
                "processed_suffix_events": self.native.iteration - prefix["processed_engine_events"],
                "first_timestamp_ns": int(self.data[8].ts_event),
            }
            self.native.end()

    try:
        adapter.BacktestEngine = StreamingProbeEngine
        chunked = adapter.execute_nautilus(rows, protocol)
    finally:
        adapter.BacktestEngine = original_engine

    assert chunked == uninterrupted
    assert result["suffix"]["total_engine_events"] == 18
    assert result["suffix"]["processed_suffix_events"] == 10
    assert len(chunked["fills"]) == 4
    result["oracle"] = {
        "same_process_chunked_equals_uninterrupted": True,
        "uninterrupted_sha256": digest(uninterrupted), "chunked_sha256": digest(chunked),
        "total_fills": len(chunked["fills"]),
        "native_trade_ids": [fill["native_trade_id"] for fill in chunked["fills"]],
        "result": chunked,
    }
    result["loaded_module_hashes"] = {
        str(Path(module.__file__).relative_to(FOUNDATION)): hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
        for module in (adapter, native_engine_module, native_cache_module)
    }
    result["limits"] = [
        "Same engine/process only; no crash/fresh-process restore oracle was performed.",
        "The accepted adapter still generates all bars/plans/quotes before quote batching.",
        "Fixed-horizon long fixture only; protective/open-position/queue/RNG/multiple-instrument resume unproven.",
        "No durable engine cursor, native state export or product job checkpoint integration was added.",
        "Streaming equality is not U5a durable mid-computation resume acceptance.",
    ]
    result["duration_seconds"] = round(time.perf_counter() - started, 4)
    print(json.dumps(result, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
