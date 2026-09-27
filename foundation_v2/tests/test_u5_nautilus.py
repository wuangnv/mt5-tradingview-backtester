from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from foundation_v2.tests import test_u5_engine_path2 as fixture
from foundation_v2.tests import test_u5_engine_oracle as oracle
from trading_workspace_v2.nautilus_worker import (
    ADAPTER_VERSION,
    NAUTILUS_VERSION,
    RUNTIME,
    adapter_hash,
    execute_native_process,
    normalize_native_result,
    runtime_identity,
    runtime_ready,
)
from trading_workspace_v2.research_engine import ResearchEngineValidationError
from trading_workspace_v2.research_validation import ResearchReconciliationError, validate_engine_result


@unittest.skipUnless(runtime_ready(), "isolated Nautilus runtime required")
class NautilusIndependentOracleTests(unittest.TestCase):
    def native_protocol(self, rows, *, direction):
        protocol = oracle.protocol_for(rows, direction=direction)
        protocol["engine"].update(
            backend="nautilus",
            native_version=NAUTILUS_VERSION,
            adapter_version=ADAPTER_VERSION,
            adapter_sha256=adapter_hash(),
            runtime_identity=runtime_identity(),
        )
        protocol["budget"]["max_memory_mb"] = 512
        return protocol

    def run_native(self, rows, *, direction):
        protocol = self.native_protocol(rows, direction=direction)
        native = execute_native_process(
            rows,
            protocol,
            continue_check=lambda: True,
            deadline=time.perf_counter() + 10,
        )
        return normalize_native_result(native, protocol), native, protocol

    def assert_decimal(self, actual, expected):
        self.assertEqual(Decimal(str(actual)), Decimal(expected))

    def test_long_and_short_match_hand_cost_tick_and_timing_oracles(self):
        cases = (
            (
                "long",
                [
                    oracle.bar(0, 9.80, 9.95, 9.70, 9.90),
                    oracle.bar(3600, 9.90, 10.10, 9.85, 10.00),
                    oracle.bar(7200, 10.00, 10.25, 9.95, 10.20),
                    oracle.bar(10800, 10.03, 10.30, 10.00, 10.21),
                ],
                "BUY",
                "10.05",
                "10.20",
                "5.56",
                "0.84",
                "4.71",
            ),
            (
                "short",
                [
                    oracle.bar(0, 10.20, 10.30, 10.00, 10.10),
                    oracle.bar(3600, 10.10, 10.20, 9.90, 10.00),
                    oracle.bar(7200, 10.00, 10.05, 9.70, 9.80),
                    oracle.bar(10800, 10.17, 10.20, 9.80, 9.93),
                ],
                "SELL",
                "10.15",
                "9.95",
                "7.41",
                "0.84",
                "6.57",
            ),
        )
        for direction, rows, side, entry, exit_, gross, fees, net in cases:
            with self.subTest(direction=direction):
                result, native, _ = self.run_native(rows, direction=direction)
                self.assertEqual(len(result["ledger"]), 1)
                trade = result["ledger"][0]
                self.assertEqual(trade["side"], side)
                self.assertEqual((trade["signal_time_utc"], trade["open_time_utc"], trade["close_time_utc"]), (10800, 10800, 14400))
                self.assertEqual(native["fills"][0]["timestamp_ns"], 10800 * 10**9 + 1)
                self.assertEqual(native["fills"][1]["timestamp_ns"], 14400 * 10**9)
                self.assert_decimal(trade["price_open"], entry)
                self.assert_decimal(trade["price_close"], exit_)
                self.assert_decimal(trade["gross_pnl"], gross)
                self.assert_decimal(trade["fees"], fees)
                self.assert_decimal(trade["net_pnl"], net)

    def test_runtime_identity_and_dependency_isolation_are_pinned(self):
        control_arrow = subprocess.check_output(
            [sys.executable, "-c", "import pyarrow; print(pyarrow.__version__)"],
            text=True,
        ).strip()
        engine_identity = subprocess.check_output(
            [str(RUNTIME / ".venv/Scripts/python.exe"), "-c", "import pyarrow,nautilus_trader; print(pyarrow.__version__,nautilus_trader.__version__)"],
            text=True,
        ).strip()
        self.assertEqual(control_arrow, "21.0.0")
        self.assertEqual(engine_identity, "25.0.1 1.231.0")
        self.assertEqual(runtime_identity()["pyarrow"], "25.0.1")

        baseline = adapter_hash()
        original_read_bytes = Path.read_bytes

        def drifted_read_bytes(path):
            payload = original_read_bytes(path)
            if path.name == "pyproject.toml":
                return payload + b"\n# synthetic manifest drift\n"
            return payload

        with patch.object(Path, "read_bytes", new=drifted_read_bytes):
            self.assertNotEqual(adapter_hash(), baseline)

    def test_runtime_version_mismatch_is_rejected_before_normalization(self):
        rows = [
            oracle.bar(0, 9.80, 9.95, 9.70, 9.90),
            oracle.bar(3600, 9.90, 10.10, 9.85, 10.00),
            oracle.bar(7200, 10.00, 10.25, 9.95, 10.20),
            oracle.bar(10800, 10.03, 10.30, 10.00, 10.21),
        ]
        _, native, protocol = self.run_native(rows, direction="long")
        native["native_version"] = "unexpected"
        with self.assertRaisesRegex(ResearchEngineValidationError, "runtime version"):
            normalize_native_result(native, protocol)

    @unittest.skipUnless(os.name == "nt", "Windows Job Objects")
    def test_worker_death_closes_owned_job_and_kills_child(self):
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]

        def alive(pid):
            handle = kernel.OpenProcess(0x00100000, False, pid)
            if not handle:
                return False
            try:
                return kernel.WaitForSingleObject(handle, 0) == 0x102
            finally:
                kernel.CloseHandle(handle)

        with tempfile.TemporaryDirectory(prefix="tw-job-owner-") as directory:
            pid_file = Path(directory) / "child.pid"
            # The helper imports the framework-independent retained modules
            # (data_contracts, data_costs, ...) from the repository root, not
            # only from the foundation_v2 package directory.
            foundation = str(RUNTIME.parent)
            repository = str(RUNTIME.parent.parent)
            script = (
                "import subprocess,sys,time\n"
                f"sys.path.insert(0, {repository!r})\n"
                f"sys.path.insert(0, {foundation!r})\n"
                "from trading_workspace_v2.nautilus_worker import _WorkerOwnedJob\n"
                "job=_WorkerOwnedJob()\n"
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])\n"
                "job.assign(child)\n"
                f"open({str(pid_file)!r},'w',encoding='utf-8').write(str(child.pid))\n"
                "time.sleep(60)\n"
            )
            helper = subprocess.Popen(
                [sys.executable, "-c", script],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            deadline = time.time() + 5
            while time.time() < deadline and not pid_file.exists() and helper.poll() is None:
                time.sleep(0.05)
            if not pid_file.exists():
                _, error = helper.communicate(timeout=2)
                self.fail(f"worker helper did not publish child pid: {error.decode(errors='replace')}")
            child_pid = int(pid_file.read_text(encoding="utf-8"))
            self.assertTrue(alive(child_pid))
            helper.kill()
            _, _ = helper.communicate(timeout=2)
            deadline = time.time() + 3
            while time.time() < deadline and alive(child_pid):
                time.sleep(0.05)
            self.assertFalse(alive(child_pid), "worker-owned Job Object did not kill child after worker death")


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL") and runtime_ready(), "Nautilus and disposable DB required")
class NautilusIntegrationTests(unittest.TestCase):
    setUpClass = fixture.U5EnginePath2Tests.__dict__["setUpClass"]
    setUp = fixture.U5EnginePath2Tests.setUp
    tearDown = fixture.U5EnginePath2Tests.tearDown
    import_dataset = fixture.U5EnginePath2Tests.import_dataset
    create_frozen_playbook = fixture.U5EnginePath2Tests.create_frozen_playbook
    engine_request = fixture.U5EnginePath2Tests.engine_request

    def queue(self, **overrides):
        manifest = self.import_dataset()
        playbook = self.create_frozen_playbook()
        request = self.engine_request(manifest, playbook, engine_backend="nautilus", max_runtime_ms=15000, **overrides)
        queued = self.client.post("/api/v2/research/engine-jobs", headers=self.headers, json=request)
        self.assertEqual(queued.status_code, 202, queued.text)
        return queued.json(), request

    def test_actual_engine_job_and_reference_agree_on_business_ledger(self):
        queued, request = self.queue()
        service = self.client.app.state.service
        result = service.run_one()
        self.assertEqual(result.execution["native_version"], "1.231.0")
        self.assertEqual(result.execution["isolation"]["process_memory_limit_mb"], 1024)
        self.assertTrue(result.execution["isolation"]["worker_owned_job_object"])
        self.assertEqual(len(result.execution["fills"]), 8)
        self.assertEqual(result.ledger[0]["price_open"], 1.0361)
        self.assertEqual(result.ledger[0]["net_pnl"], 36.0)
        self.assertTrue(result.ledger[0]["execution_link"]["entry_fill_id"])
        self.assertEqual(result.protocol["engine"]["backend"], "nautilus")
        self.assertTrue(result.protocol["engine"]["adapter_sha256"])
        self.assertEqual(result.execution["runtime_identity"], result.protocol["engine"]["runtime_identity"])

        tampered = result.model_dump(mode="json")
        tampered["execution"]["fills"][0]["price"] = "999.99"
        with self.assertRaisesRegex(ResearchReconciliationError, "native_entry.price"):
            validate_engine_result(tampered)

        reference = self.client.post("/api/v2/research/engine-jobs", headers=self.headers,
                                     json={**request, "engine_backend": "reference"})
        self.assertEqual(reference.status_code, 202)
        expected = service.run_one()
        self.assertEqual(result.signals, expected.signals)
        self.assertEqual(result.metrics, expected.metrics)
        business_ledger = lambda items: [{key: value for key, value in item.items() if key != "execution_link"} for item in items]
        self.assertEqual(business_ledger(result.ledger), business_ledger(expected.ledger))
        self.assertEqual(self.store.get_job("tenant-a", queued["job_id"]).status, "completed")

    def test_timeout_kills_process_and_never_publishes(self):
        queued, request = self.queue()
        self.client.app.state.service.cancel_job("tenant-a", queued["job_id"])
        queued = self.client.post("/api/v2/research/engine-jobs", headers=self.headers,
                                  json={**request, "max_runtime_ms": 100}).json()
        processes = []
        popen = subprocess.Popen

        def tracked(*args, **kwargs):
            process = popen(*args, **kwargs)
            processes.append(process)
            return process

        with patch("trading_workspace_v2.nautilus_worker.subprocess.Popen", side_effect=tracked):
            with self.assertRaisesRegex(ValueError, "budget.max_runtime_ms"):
                self.client.app.state.service.run_one()
        self.assertTrue(all(process.poll() is not None for process in processes))
        job = self.store.get_job("tenant-a", queued["job_id"])
        self.assertEqual(job.status, "failed")
        self.assertIsNone(job.result_path)

    def test_cancellation_stops_running_native_child(self):
        queued, _ = self.queue()
        service = self.client.app.state.service
        processes = []
        popen = subprocess.Popen

        def tracked(*args, **kwargs):
            process = popen(*args, **kwargs)
            processes.append(process)
            return process

        def cancel_during(rows, protocol, *, continue_check, deadline):
            calls = 0

            def cancellation():
                nonlocal calls
                calls += 1
                if calls == 3:
                    service.cancel_job("tenant-a", queued["job_id"])
                return continue_check()

            return execute_native_process(rows, protocol, continue_check=cancellation, deadline=deadline)

        with patch("trading_workspace_v2.research.execute_native_process", side_effect=cancel_during):
            with patch("trading_workspace_v2.nautilus_worker.subprocess.Popen", side_effect=tracked):
                self.assertIsNone(service.run_one())
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll())
        job = self.store.get_job("tenant-a", queued["job_id"])
        self.assertEqual(job.status, "canceled")
        self.assertIsNone(job.result_path)

    def test_primary_engine_is_explicit_and_new_requests_default_to_it(self):
        queued, request = self.queue()
        self.client.app.state.service.cancel_job("tenant-a", queued["job_id"])
        request.pop("engine_backend")
        queued = self.client.post("/api/v2/research/engine-jobs", headers=self.headers, json=request)
        self.assertEqual(queued.json()["protocol"]["engine"]["backend"], "nautilus")
        engines = self.client.get("/api/v2/research/engines", headers=self.headers).json()
        self.assertEqual(engines["primary"], "nautilus")


if __name__ == "__main__":
    unittest.main(verbosity=2)
