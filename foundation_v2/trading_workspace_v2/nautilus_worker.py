from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import time
import tomllib
from decimal import Decimal
from pathlib import Path

from .research_engine import ResearchEngineInterrupted, ResearchEngineValidationError
from .retained import CostModel, calculate_round_trip_cost, compute_metrics_v2


RUNTIME = Path(__file__).resolve().parents[1] / "engine_runtime"
NAUTILUS_VERSION = "1.231.0"
ADAPTER_VERSION = "nautilus-breakout-v1"


class _WorkerOwnedJob:
    """Owns engine lifecycle; the child applies its own resource ceilings."""

    def __init__(self):
        if os.name != "nt":
            raise ResearchEngineValidationError("isolated Nautilus runtime is verified on Windows only")
        import ctypes
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [
                ("process_time", ctypes.c_longlong),
                ("job_time", ctypes.c_longlong),
                ("flags", wintypes.DWORD),
                ("min_ws", ctypes.c_size_t),
                ("max_ws", ctypes.c_size_t),
                ("process_count", wintypes.DWORD),
                ("affinity", ctypes.c_size_t),
                ("priority", wintypes.DWORD),
                ("scheduling", wintypes.DWORD),
            ]

        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("read", "write", "other", "read_bytes", "write_bytes", "other_bytes")]

        class Extended(ctypes.Structure):
            _fields_ = [
                ("basic", BasicLimits),
                ("io", IO),
                ("process_memory", ctypes.c_size_t),
                ("job_memory", ctypes.c_size_t),
                ("peak_process", ctypes.c_size_t),
                ("peak_job", ctypes.c_size_t),
            ]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.CreateJobObjectW(None, None)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = Extended()
        # Keep this parent-owned job lifecycle-only. The venv launcher briefly
        # creates the real interpreter, so imposing an active-process ceiling
        # here would block startup. The engine process applies memory/count
        # ceilings itself after interpreter startup.
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            kernel.CloseHandle(handle)
            raise ctypes.WinError(ctypes.get_last_error())
        self._ctypes = ctypes
        self._kernel = kernel
        self._wintypes = wintypes
        self._handle = handle

    def assign(self, process):
        if self._handle is None:
            raise ResearchEngineValidationError("engine job object is closed")
        process_handle = self._wintypes.HANDLE(int(process._handle))
        if not self._kernel.AssignProcessToJobObject(self._handle, process_handle):
            raise self._ctypes.WinError(self._ctypes.get_last_error())

    def close(self):
        if self._handle is not None:
            self._kernel.CloseHandle(self._handle)
            self._handle = None


def adapter_hash():
    paths = [RUNTIME / name for name in ("adapter.py", "limits.py", "run.py", "pyproject.toml", "uv.lock")]
    return hashlib.sha256(json.dumps({path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}, sort_keys=True).encode()).hexdigest()


def runtime_ready():
    return os.name == "nt" and (RUNTIME / ".venv/Scripts/python.exe").is_file() and (RUNTIME / "uv.lock").is_file()


def runtime_identity():
    if not runtime_ready():
        raise ResearchEngineValidationError("isolated Nautilus runtime is unavailable")
    completed = subprocess.run(
        [
            str(RUNTIME / ".venv/Scripts/python.exe"),
            "-I",
            "-c",
            "import json,platform,pyarrow,nautilus_trader; print(json.dumps({'python':platform.python_version(),'pyarrow':pyarrow.__version__,'nautilus_trader':nautilus_trader.__version__},sort_keys=True))",
        ],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=10,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if completed.returncode:
        raise ResearchEngineValidationError(f"isolated Nautilus runtime identity probe failed: {completed.stderr[-1000:]}")
    try:
        identity = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ResearchEngineValidationError("isolated Nautilus runtime identity is invalid") from exc
    locked = tomllib.loads((RUNTIME / "uv.lock").read_text(encoding="utf-8"))
    versions = {package["name"]: package.get("version") for package in locked.get("package", [])}
    expected = {"nautilus_trader": versions.get("nautilus-trader"), "pyarrow": versions.get("pyarrow")}
    if identity.get("nautilus_trader") != expected["nautilus_trader"] or identity.get("pyarrow") != expected["pyarrow"]:
        raise ResearchEngineValidationError("isolated Nautilus runtime differs from uv.lock")
    if identity.get("nautilus_trader") != NAUTILUS_VERSION:
        raise ResearchEngineValidationError("isolated Nautilus runtime differs from supported adapter version")
    return identity


def execute_native_process(rows, protocol, *, continue_check, deadline):
    if not runtime_ready():
        raise ResearchEngineValidationError("isolated Nautilus runtime is unavailable")
    expected_hash = protocol["engine"]["adapter_sha256"]
    if adapter_hash() != expected_hash:
        raise ResearchEngineValidationError("Nautilus adapter changed after job creation")
    with tempfile.TemporaryDirectory(prefix="tw-nautilus-") as directory:
        directory = Path(directory)
        source, result_path = directory / "input.json", directory / "result.json"
        source.write_text(json.dumps({"rows": rows, "protocol": protocol}, allow_nan=False), encoding="utf-8")
        job = _WorkerOwnedJob()
        process = subprocess.Popen(
            [str(RUNTIME / ".venv/Scripts/python.exe"), "-I", str(RUNTIME / "run.py"),
             "--input", str(source), "--output", str(result_path), "--source-hash", expected_hash,
             "--memory-mb", str(protocol["budget"]["max_memory_mb"])],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        error_bytes = b""
        try:
            job.assign(process)
            while True:
                if time.perf_counter() >= deadline:
                    raise ResearchEngineValidationError("run exceeded budget.max_runtime_ms")
                if not continue_check():
                    raise ResearchEngineInterrupted("research execution interrupted")
                try:
                    process.wait(timeout=0.05)
                    break
                except subprocess.TimeoutExpired:
                    pass
        finally:
            if process.poll() is None:
                job.close()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
            else:
                job.close()
            _, error_bytes = process.communicate()
        if process.returncode:
            detail = error_bytes[-4096:].decode("utf-8", errors="replace")
            raise ResearchEngineValidationError(f"Nautilus process failed ({process.returncode}): {detail}")
        if not result_path.is_file() or adapter_hash() != expected_hash:
            raise ResearchEngineValidationError("Nautilus output missing or adapter changed")
        result = json.loads(result_path.read_text(encoding="utf-8"))
        result.setdefault("isolation", {})["worker_owned_job_object"] = True
        return result


def normalize_native_result(native, protocol):
    engine = protocol["engine"]
    if native.get("native_version") != engine.get("native_version"):
        raise ResearchEngineValidationError("Nautilus runtime version does not match queued protocol")
    if native.get("adapter_version") != engine.get("adapter_version"):
        raise ResearchEngineValidationError("Nautilus adapter version does not match queued protocol")
    if native.get("runtime_identity") != engine.get("runtime_identity"):
        raise ResearchEngineValidationError("Nautilus runtime identity does not match queued protocol")
    rules = protocol["playbook"]["rules"]
    spec = protocol["dataset"]["instrument_spec"]
    model = CostModel.from_mapping(protocol["parameters"]["cost_model"])
    quantity = Decimal(str(rules["quantity"]))
    contract = Decimal(str(spec["contract_size"]))
    risk = Decimal(str(rules["planned_stop_distance_price"])) * quantity * contract * model.quote_to_account_rate
    fills = native["fills"]
    if len(fills) % 2:
        raise ResearchEngineValidationError("native fills do not form completed trades")
    ledger = []
    for opened, closed in zip(fills[::2], fills[1::2]):
        if opened["role"] != "entry" or closed["role"] != "exit" or opened["side"] == closed["side"]:
            raise ResearchEngineValidationError("native fill lifecycle mismatch")
        if any(Decimal(fill["units"]) != quantity * contract for fill in (opened, closed)):
            raise ResearchEngineValidationError("native fill quantity mismatch")
        cost = calculate_round_trip_cost(model, opened["side"], quantity, contract,
                                         opened["price"], opened["price"], closed["price"], closed["price"])
        fees = sum(Decimal(str(cost[key])) for key in ("commission_account", "slippage_account", "financing_account"))
        adjustment = Decimal(str(cost["net_account"])) - Decimal(str(cost["gross_account"])) + fees
        ledger.append({"trade_id": f"engine-{len(ledger) + 1}", "signal_time_utc": opened["signal_time_utc"],
                       "open_time_utc": opened["timestamp_ns"] // 10**9, "close_time_utc": closed["timestamp_ns"] // 10**9,
                       "symbol": spec["instrument_id"], "side": opened["side"], "quantity": float(quantity),
                       "price_open": cost["entry_fill"], "price_close": cost["exit_fill"],
                       "gross_pnl": cost["gross_account"], "fees": float(fees), "rounding_adjustment": float(adjustment),
                       "costs": cost, "net_pnl": cost["net_account"], "planned_risk_budget": float(risk),
                       "realized_r": float(Decimal(str(cost["net_account"])) / risk), "exit_model": "fixed_horizon_bar_close",
                       "execution_link": {
                           "entry_order_id": opened["client_order_id"], "exit_order_id": closed["client_order_id"],
                           "entry_fill_id": opened["native_trade_id"], "exit_fill_id": closed["native_trade_id"],
                           "entry_timestamp_ns": opened["timestamp_ns"], "exit_timestamp_ns": closed["timestamp_ns"],
                       }})
    return {"ledger": ledger, "metrics": compute_metrics_v2(ledger, protocol["starting_balance"]),
            "signals": native["signals"], "observed_range": native["observed_range"], "execution": native,
            "assumptions": {"execution_engine": "nautilus-trader", "engine_version": native["native_version"],
                            "timing": "closed bar -> next open +1ns modeled ordering; fixed-horizon close",
                            "price_basis": native["quote_model"], "spread_price": protocol["parameters"]["spread_price"],
                            "costs": "retained modeled costs applied to native fills; no broker or native fee claim",
                            "cost_model_version": model.version, "rounding": "explicit rounding_adjustment",
                            "planned_risk_model": "fixed_stop_distance_budget_v1", "protective_orders": "not yet supported",
                            "margin_model": "Nautilus default FX margin; not an accepted broker margin model",
                            "data_quality": protocol["dataset"].get("quality"), "data_source": protocol["dataset"].get("source")}}
