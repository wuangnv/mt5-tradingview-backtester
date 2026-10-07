"""Catalog API test in a disposable loopback DB; upstream calls intercepted."""
import json
import os
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "foundation_v2"))
sys.path.insert(0, str(ROOT))
import httpx
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from fastapi.testclient import TestClient
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.dukascopy_catalog import DukascopyCatalog

config = conninfo_to_dict(os.environ["TW_V2_DATABASE_URL"])
assert config.get("host") in {"127.0.0.1", "localhost", "::1"}
name = "catalog_qa_" + uuid4().hex
admin = make_conninfo(**{**config, "dbname": "postgres"})
dsn = make_conninfo(**{**config, "dbname": name})
calls = []
def handler(request):
    calls.append(request)
    return httpx.Response(200, json=[{"id": 1, "name": "EUR/USD", "nameLong": "QA metadata only"}])
report = {"scope": "disposable PostgreSQL, mock upstream, temporary cache", "checks": []}
with psycopg.connect(admin, autocommit=True) as conn:
    conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
try:
    with tempfile.TemporaryDirectory() as temporary, httpx.Client(transport=httpx.MockTransport(handler)) as upstream:
        path = Path(temporary) / "catalog.json"
        provider = DukascopyCatalog(path, "qa-not-a-real-key", client=upstream)
        auth = LocalWorkspaceAuthorization.for_local_owner(["catalog-qa"], identity_id="catalog-qa-owner")
        with TestClient(create_app(dsn=dsn, artifact_root=temporary, authorization=auth, instrument_catalog=provider)) as client:
            headers = {"X-Workspace-Id": "catalog-qa"}
            empty = client.get("/api/v2/data/datasets", headers=headers)
            assert empty.status_code == 200 and empty.json()["catalog_items"] == [] and not calls
            denied = client.post("/api/v2/data/catalog/refresh", headers={"X-Workspace-Id": "tenant-a"})
            assert denied.status_code == 403 and not calls and not path.exists()
            refreshed = client.post("/api/v2/data/catalog/refresh", headers=headers)
            assert refreshed.status_code == 200 and len(calls) == 1
            assert len(refreshed.json()["catalog_items"]) == 1
            assert refreshed.json()["catalog_state"]["status"] == "cached"
            assert "qa-not-a-real-key" not in refreshed.text
            read = client.get("/api/v2/data/datasets", headers=headers)
            assert read.json()["items"] == [] and len(read.json()["catalog_items"]) == 1
            client.post("/api/v2/data/catalog/refresh", headers=headers)
            assert len(calls) == 1
            report["checks"].append("authorized refresh, unauthorized no I/O, GET no I/O, no history dataset, cooldown, no exposed key")
        restarted = DukascopyCatalog(path)
        with TestClient(create_app(dsn=dsn, artifact_root=temporary, authorization=auth, instrument_catalog=restarted)) as client:
            offline = client.get("/api/v2/data/datasets", headers=headers)
            assert len(offline.json()["catalog_items"]) == 1 and not offline.json()["catalog_state"]["configured"]
            failed = client.post("/api/v2/data/catalog/refresh", headers=headers)
            assert failed.json()["catalog_state"]["error"] == "missing_key" and len(failed.json()["catalog_items"]) == 1
            assert len(calls) == 1
            report["checks"].append("restart without key reuses cached list; missing-key refresh retains rows")
        report["pass"] = True
finally:
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
Path(__file__).with_name("api-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
