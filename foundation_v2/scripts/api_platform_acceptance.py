"""Isolated real-process acceptance; never uses a user DSN or provider downloads."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import argparse
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
sys.path[:0] = [str(ROOT), str(V2), str(V2 / "tests")]
import httpx
import psycopg
from trading_workspace_v2.store import PostgresStore
from test_replay_execution_core import initial_state
from test_ps01_prop_persistence import profile
from trading_workspace_v2.prop_session import PropSessionSnapshot

PG = Path(os.environ.get("TW_PLATFORM_TEST_PG_BIN", "D:/ANNAM/TradingWorkspace/planning/mt5-tradingview-backtester/research/foundation-validation/20260921T115933Z-315e8ddd/pg-dist/pgsql/bin"))
OUT = V2 / "evidence/api-platform-implementation-20261009/integrated"


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_until(check, seconds=50):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                return value
        except (OSError, httpx.HTTPError):
            pass
        time.sleep(.1)
    raise AssertionError("Fixture readiness deadline exceeded")


def main():
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--rust-binary', type=Path)
    parser.add_argument('--production-dist', type=Path)
    parser.add_argument('--frontend-reads', action='store_true')
    args = parser.parse_args()
    if args.output: OUT = args.output.resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"scope": "Owned disposable PostgreSQL + real Axum/domain/research/supervisor HTTP processes; synthetic data; no user DB/provider/broker", "cases": []}
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="tw-platform-acceptance-") as temporary:
        work = Path(temporary)
        data, artifacts = work / "pg", work / "artifacts"
        artifacts.mkdir()
        pgport, apiport, uiport = port(), port(), port()
        def pg_run(name, *args):
            subprocess.run([str(PG / f"{name}.exe"), *args], check=True, timeout=45,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        pg_run("initdb", "-D", str(data), "-U", "platform_fixture", "-A", "trust", "--locale=C", "--encoding=UTF8")
        pg_run("pg_ctl", "-D", str(data), "-l", str(work / "pg.log"), "-o", f"-h 127.0.0.1 -p {pgport} -c max_connections=64 -c shared_buffers=32MB", "-w", "start")
        dsn = f"host=127.0.0.1 port={pgport} user=platform_fixture dbname=postgres connect_timeout=5"
        env = {**os.environ, "TW_V2_DATABASE_URL": dsn, "TW_V2_RUST_COMMAND_WAIT_TIMEOUT_MS": "800",
               "TW_V2_RUST_REQUEST_TIMEOUT_MS": "10000", "TW_V2_RUST_REQUESTS_PER_MINUTE": "10000"}
        base = [sys.executable, "-B", str(V2 / "scripts/run_api_platform.py"), "--database-name", "postgres",
                "--port", str(apiport), "--artifact-root", str(artifacts), "--download-engine", "none",
                "--manifest", str(work / "runtime/owner.json")]
        if args.rust_binary: base.extend(['--rust-binary', str(args.rust_binary.resolve())])
        processes, logs = [], []
        try:
            # Only this fresh fixture database is initialized explicitly.
            subprocess.run([*base, "--setup-only", "--migrate"], env=env, cwd=V2, check=True, capture_output=True, timeout=45)
            store = PostgresStore(dsn)
            store.ensure_workspace("tenant-a")
            store.close()
            ui_command = ["node", "node_modules/vite/bin/vite.js"]
            if args.production_dist: ui_command.extend(['preview', '--outDir', str(args.production_dist.resolve())])
            ui_command.extend(['--port', str(uiport), '--strictPort'])
            report['frontend_build'] = 'production' if args.production_dist else 'development'
            for name, command, cwd in [("supervisor", base, V2), ("vite", ui_command, V2 / "web")]:
                handle = (OUT / f"{name}.log").open("wb"); logs.append(handle)
                processes.append(subprocess.Popen(command, env={**env, "TW_V2_API_TARGET": f"http://127.0.0.1:{apiport}"}, cwd=cwd,
                    stdout=handle, stderr=handle, creationflags=subprocess.CREATE_NO_WINDOW))
            api = f"http://127.0.0.1:{apiport}"
            client = httpx.Client(base_url=api, headers={"X-Workspace-Id": "tenant-a"}, timeout=15)
            wait_until(lambda: client.get("/health/ready").status_code == 200)
            wait_until(lambda: httpx.get(f"http://127.0.0.1:{uiport}").status_code == 200)
            def request(method, path, body=None, expected=200, key=None):
                response = client.request(method, path, json=body, headers={"Idempotency-Key": key} if key else {})
                assert response.status_code == expected, (method, path, response.status_code, response.text[:500])
                return response.json()
            assert httpx.get(api + "/api/v2/replay/sessions").status_code == 422
            assert client.get("/api/v2/replay/sessions", headers={"X-Workspace-Id": "tenant-b"}).status_code == 403
            assert client.head("/api/v2/replay/sessions").status_code == 405
            request("POST", "/api/v2/replay/sessions", {}, 422)
            assert client.post("/api/v2/replay/sessions", content="{broken", headers={"Content-Type": "application/json"}).status_code == 422
            assert client.get("/internal/metrics").status_code == 404
            assert "/api/v2/commands/{command_id}" in request("GET", "/openapi.json")["paths"]
            report["cases"].append("actual HTTP header isolation, HEAD/error/validation, protected metrics and OpenAPI")
            datasets = []
            for symbol in ("EURUSD", "XAUUSD"):
                payload = {"csv_text": "time,open,high,low,close,volume\n" + "\n".join(f"{1767225600+i*60},1.1,1.105,1.099,1.102,10" for i in range(40)),
                    "source": {"source_id": "platform-fixture", "provider": "fixture", "instrument_mapping": {symbol: symbol},
                               "license_use": "qa-only", "retrieved_at_utc": "2026-10-09T00:00:00Z", "export_settings": "synthetic acceptance"},
                    "instrument": {**initial_state().instrument_spec, "instrument_id": symbol}, "timeframe_seconds": 60, "holdout_policy": {"mode": "none"}}
                preview = request("POST", "/api/v2/data/csv/preview", payload)
                imported = request("POST", "/api/v2/data/csv/import", payload, 201)
                assert preview["preview"]["normalized_sha256"] == imported["dataset"]["normalized_sha256"]
                datasets.append(imported["dataset"]["dataset_id"])
            report["cases"].append("queued CSV preview/import hashes, immutable Parquet and catalog")
            body = {"dataset_id": datasets[0], "dataset_ids": datasets, "starting_balance": "100000.00", "name": "HTTP multiasset fixture"}
            session = request("POST", "/api/v2/replay/sessions", body, 201, "create-fixture")
            assert request("POST", "/api/v2/replay/sessions", body, 201, "create-fixture")["record_id"] == session["record_id"]
            request("POST", "/api/v2/replay/sessions", {**body, "name": "different"}, 409, "create-fixture")
            identifier = session["record_id"]
            assert len(request("GET", "/api/v2/replay/sessions")["items"]) == 1
            assert request("GET", f"/api/v2/replay/sessions/{identifier}")["record_id"] == identifier
            state = initial_state()
            execution = {"expected_revision": 1, "instrument_spec": state.instrument_spec, "cost_model": state.cost_model,
                         "spread_price": "0.0002", "timeframe_seconds": 60, "starting_balance": "100000.00"}
            request("POST", f"/api/v2/replay/sessions/{identifier}/execution", execution)
            order = {"expected_revision": 2, "operation_id": "http-order", "side": "BUY", "quantity": "0.10", "stop_loss": "1.0900", "take_profit": "1.1200"}
            request("POST", f"/api/v2/replay/sessions/{identifier}/orders/market", order, key="http-order")
            request("POST", f"/api/v2/replay/sessions/{identifier}/orders/market", order, key="http-order")
            stepped = request("POST", f"/api/v2/replay/sessions/{identifier}/step", {"expected_revision": 3, "steps": 1})
            assert stepped["revision"] == 4 and stepped["payload"]["execution"]["position"]["entry_fill"] == "1.1001"
            assert stepped["payload"]["execution"]["balance"] == "100000.00"
            report["cases"].append("multiasset shared session, idempotent creates/orders, conflict and exact Decimal fill/balance/revision/cutoff")
            if args.frontend_reads:
                dashboard = request('GET', '/api/v2/dashboard/sessions')
                assert dashboard['schema_version'] == 'dashboard-session-list-v1'
                assert dashboard['items'][0]['record_id'] == identifier
                metadata = request('GET', f'/api/v2/replay/sessions/{identifier}/metadata')
                assert metadata['schema_version'] == 'replay-metadata-v1' and metadata['revision'] == 4
                assert not {'ledger', 'visible_rows', 'positions', 'position'} & metadata['payload'].keys()
                request('GET', '/api/v2/dashboard/sessions?revision=' + '0'*64, expected=409)
                context = request('GET', f'/api/v2/journal/context?session_id={identifier}')
                assert context['record_count'] == 0 and context['trades'] == []
                request('GET', '/api/v2/journal/context?session_id=not-found', expected=404)
                view = request('GET', f'/api/v2/replay/sessions/{identifier}')
                query = f'dataset_id={datasets[0]}&dataset_sha256={view["dataset_sha256"]}&resolution=1&count_back=2'
                window = request('GET', f'/api/v2/replay/sessions/{identifier}/chart-window?{query}')
                assert window['schema_version'] == 'replay-chart-window-v1' and len(window['bars']) <= 2
                assert all(bar['time'] <= view['cutoff_timestamp']*1000 for bar in window['bars'])
                request('GET', f'/api/v2/replay/sessions/{identifier}/chart-window?{query}&cursor_index=1000', expected=422)
                request('GET', f'/api/v2/replay/sessions/{identifier}/chart-window?{query}&count_back=2001', expected=422)
                request('GET', f'/api/v2/replay/sessions/{identifier}/chart-window?{query.replace(view["dataset_sha256"], "0"*64)}', expected=422)
                timestamp = view['visible_rows'][0]['timestamp']
                rewind = request('GET', f'/api/v2/replay/sessions/{identifier}?cutoff_timestamp={timestamp}')
                assert rewind['view_cursor_index'] == 0 and rewind['historical_view']
                request('GET', f'/api/v2/replay/sessions/{identifier}?cutoff_timestamp={view["cutoff_timestamp"]+1}', expected=422)
                pages = [request('GET', '/api/v2/replay/trades?page=1&page_size=10') for _ in range(2)]
                assert pages[0] == pages[1]
                samples, sizes = [], []
                for _ in range(30):
                    begin = time.perf_counter()
                    response = client.get('/api/v2/dashboard/sessions')
                    assert response.status_code == 200
                    samples.append((time.perf_counter()-begin)*1000); sizes.append(len(response.content))
                report['frontend_reads'] = {'samples': 30, 'dashboard_warm_median_ms': round(statistics.median(samples), 2),
                    'dashboard_sample_p95_ms': round(sorted(samples)[28], 2), 'dashboard_payload_bytes': max(sizes),
                    'scope': 'real Axum/domain/PG HTTP; one small multiasset fixture; not capacity or before/after'}
                report['cases'].append('bounded metadata/dashboard/journal/chart routes, revision/hash/cutoff denial and repeat-page parity through real Axum')
            prop = PropSessionSnapshot(workspace_id="tenant-a", session_id="http-prop-fixture", profile=profile(), status="running")
            request("POST", "/api/v2/prop/sessions", prop.model_dump(mode="json"), 201)
            assert request("GET", "/api/v2/prop/sessions/http-prop-fixture")["profile"]["phases"][0]["initial_capital"] == "100000"
            playbook = {"name": "HTTP fixture", "status": "draft", "execution_capability": "manual-only", "rules": {"entry": "fixture"}}
            created = request("POST", "/api/v2/playbooks", playbook, 201)
            revised = request("POST", f"/api/v2/playbooks/{created['record_id']}/revisions", {"expected_revision": 1, "payload": {**playbook, "name": "revised"}})
            assert revised["revision"] == 2
            request("POST", f"/api/v2/playbooks/{created['record_id']}/revisions", {"expected_revision": 1, "payload": playbook}, 409)
            report["cases"].append("queued Prop financial snapshot + native validation; playbook CAS revision")
            job = request("POST", "/api/v2/research/jobs", {"dataset_id": datasets[0], "starting_balance": 100000}, 202)
            result = wait_until(lambda: (value if (value := request("GET", f"/api/v2/research/jobs/{job['job_id']}"))["status"] in {"completed", "failed"} else None))
            assert result["status"] == "completed", result
            assert result["result"]["dataset_id"] == datasets[0]
            report["cases"].append("separate supervised research worker completed job and immutable result read through HTTP")
            # Hold the domain write at the database, so HTTP returns a genuine receipt.
            with psycopg.connect(dsn) as blocker:
                blocker.execute("LOCK TABLE workspace_records IN SHARE MODE")
                slow_body = {**playbook, "name": "blocked-public-write"}
                pending = request("POST", "/api/v2/playbooks", slow_body, 504, "slow-fixture")
                assert pending["detail"] == "command_pending"
                status_url = pending["status_url"]
                assert request("GET", status_url)["status"] in {"queued", "running"}
                assert client.get(status_url, headers={"X-Workspace-Id": "tenant-b"}).status_code == 403
                blocker.commit()
            completed = wait_until(lambda: (value if (value := request("GET", status_url))["status"] == "completed" else None))
            assert completed["result_status"] == 201
            assert request("POST", "/api/v2/playbooks", slow_body, 201, "slow-fixture")["record_id"] == completed["result_body"]["record_id"]
            report["cases"].append("genuine blocked write 504 receipt, scope isolation, reconciliation and same-key retry without duplicate")
            def measured(index):
                endpoint = "/api/v2/replay/sessions" if index % 2 else "/api/v2/data/datasets"
                begin = time.perf_counter(); request("GET", endpoint)
                return (time.perf_counter() - begin) * 1000
            with ThreadPoolExecutor(max_workers=8) as executor:
                samples = list(executor.map(measured, range(80)))
            samples.sort()
            report["mixed_load"] = {"requests": 80, "concurrency": 8, "fixture_datasets": 2, "rows_per_dataset": 40,
                "p50_ms": round(statistics.median(samples), 2), "p95_ms": round(samples[int(len(samples)*.95)-1], 2),
                "p99_ms": round(samples[int(len(samples)*.99)-1], 2), "errors": 0, "not_human_user_capacity": True}
            env_browser = {**env, "TW_UI_ORIGIN": f"http://127.0.0.1:{uiport}", "TW_ACCEPTANCE_OUTPUT": str(OUT)}
            browser_run = subprocess.run(["node", "tests/apiPlatform.browser.mjs"], cwd=V2 / "web", env=env_browser, capture_output=True, text=True, timeout=100)
            (OUT / "browser.log").write_text(browser_run.stdout + browser_run.stderr, encoding="utf-8")
            assert browser_run.returncode == 0, browser_run.stdout + browser_run.stderr
            report["cases"].append("real React UI created multiasset session through public Axum; shell navigation and workspace SSE")
            manifest = json.loads((work / "runtime/owner.json").read_text())
            Path(manifest["stop_file"]).write_text("stop\n")
            processes[0].wait(timeout=55)
            assert processes[0].returncode == 0
            assert json.loads((work / "runtime/owner.json").read_text())["stopped"]
            client.close()
            report["cases"].append("supervisor startup readiness, marker drain, exact owned child teardown")
            report["result"] = "PASS"
        finally:
            manifest_path = work / "runtime/owner.json"
            if manifest_path.exists():
                manifest = json.loads(manifest_path.read_text()); Path(manifest["stop_file"]).write_text("stop\n")
            for child in processes:
                try: child.wait(timeout=55 if child is processes[0] else 1)
                except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=5)
            for handle in logs: handle.close()
            for path in (work / "runtime").glob("*.log"):
                (OUT / path.name).write_bytes(path.read_bytes())
            pg_run("pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop")
            report["fixture_postgres_stopped"] = not (data / "postmaster.pid").exists()
            report["elapsed_seconds"] = round(time.monotonic() - started, 2)
            (OUT / "receipt.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
