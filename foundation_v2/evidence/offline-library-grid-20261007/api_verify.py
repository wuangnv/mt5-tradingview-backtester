"""Real CSV/API verification in a disposable loopback database and artifact root."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT), str(ROOT / "foundation_v2")]
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from fastapi.testclient import TestClient
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization

config = conninfo_to_dict(os.environ["TW_V2_DATABASE_URL"])
assert config.get("host") in ("localhost", "127.0.0.1", "::1"), "loopback only"
admin_dsn = make_conninfo(**{**config, "dbname": "postgres"})
name = "offline_library_qa_" + uuid4().hex
dsn = make_conninfo(**{**config, "dbname": name})
report = {"scope": "disposable loopback PostgreSQL and temporary artifacts", "checks": []}
with psycopg.connect(admin_dsn, autocommit=True) as conn:
    conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
try:
    env = {**os.environ, "TW_V2_DATABASE_URL": dsn, "PYTHONPATH": os.pathsep.join([str(ROOT), str(ROOT / "foundation_v2")])}
    for module in ("test_u2_provider_boundary.py", "test_u2_provider_readiness.py", "test_u2_data_desk_payload.py", "test_u2_data_ingest.py"):
        result = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", module], cwd=ROOT/"foundation_v2", env=env, capture_output=True, text=True)
        report["checks"].append({"name": module, "pass": result.returncode == 0, "output": result.stdout + result.stderr})
        assert result.returncode == 0, module + " failed"
    with tempfile.TemporaryDirectory(prefix="offline-library-qa-") as temporary:
        app = create_app(dsn=dsn, artifact_root=temporary, authorization=LocalWorkspaceAuthorization.for_local_owner(["library-qa"], identity_id="library-review"))
        with TestClient(app) as client:
            headers = {"X-Workspace-Id": "library-qa"}
            payload = {
                "csv_text": "time,open,high,low,close,volume\n2026-01-05T00:00:00Z,2500,2502,2498,2501,1\n2026-01-05T01:00:00Z,2501,2503,2500,2502,2\n",
                "source": {"source_id": "qa-metal", "provider": "fixture-csv", "instrument_mapping": {"XAUUSD": "XAUUSD"}, "license_use": "qa-only", "retrieved_at_utc": "2026-01-06T00:00:00Z", "export_settings": "qa"},
                "instrument": {"instrument_id": "XAUUSD", "asset_class": "metal", "base_ccy": "XAU", "quote_ccy": "USD", "account_ccy": "USD", "tick_size": "0.01", "pip_size": "0.01", "contract_size": "100", "quantity_min": "0.01", "quantity_step": "0.01", "effective_from_utc": "1970-01-01T00:00:00Z", "effective_to_utc": ""},
                "timeframe_seconds": 3600, "holdout_policy": {"mode": "none"},
            }
            preview = client.post("/api/v2/data/csv/preview", headers=headers, json=payload)
            assert preview.status_code == 200, preview.text
            first = client.post("/api/v2/data/csv/import", headers=headers, json=payload)
            assert first.status_code == 201, first.text
            first = first.json()["dataset"]
            assert first["dataset_id"] == preview.json()["preview"]["dataset_id"]
            old_bytes = (Path(temporary) / first["artifact_path"]).read_bytes()
            updated = {**payload, "csv_text": payload["csv_text"] + "2026-01-05T02:00:00Z,2502,2504,2501,2503,2\n"}
            second = client.post("/api/v2/data/csv/import", headers=headers, json=updated)
            assert second.status_code == 201, second.text
            second = second.json()["dataset"]
            assert first["dataset_id"] != second["dataset_id"]
            assert (Path(temporary) / first["artifact_path"]).read_bytes() == old_bytes
            listing = client.get("/api/v2/data/datasets", headers=headers)
            assert listing.status_code == 200
            assert len(listing.json()["items"]) == 2
            assert {item["instrument_spec"]["asset_class"] for item in listing.json()["items"]} == {"metal"}
            assert listing.json()["catalog_items"] == []  # No invented Dukascopy inventory.
            assert client.get("/api/v2/data/datasets", headers={"X-Workspace-Id":"tenant-a"}).status_code == 403
            report["checks"].append({"name":"real-metal-preview-import-version-isolation", "pass":True, "datasets":2, "previous_bytes_unchanged":True, "unauthorized_workspace":403})
    report["pass"] = True
finally:
    with psycopg.connect(admin_dsn, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
    Path(__file__).with_name("api-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"pass":report.get("pass",False), "checks":[{"name":c["name"],"pass":c["pass"]} for c in report["checks"]]}))
