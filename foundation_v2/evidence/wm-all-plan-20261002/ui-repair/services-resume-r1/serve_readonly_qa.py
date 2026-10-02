import ipaddress
import os
import sys
from pathlib import Path

import psycopg
import uvicorn
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from starlette.responses import JSONResponse

workspace = Path(r"D:\ANNAM\TradingWorkspace")
repo = workspace / "projects/mt5-tradingview-backtester"
config = conninfo_to_dict(os.environ["TW_V2_DATABASE_URL"])
if config.get("host") not in {"127.0.0.1", "localhost", "::1"}:
    raise RuntimeError("QA server must be loopback")
config["dbname"] = "trading_workspace_v2_ui_20261001"
dsn = make_conninfo(**config)
with psycopg.connect(dsn, autocommit=True, connect_timeout=5) as conn:
    database, address = conn.execute("SELECT current_database(), host(inet_server_addr())").fetchone()
ip = ipaddress.ip_address(address)
if database != config["dbname"] or not (ip.is_loopback or (getattr(ip, "ipv4_mapped", None) and ip.ipv4_mapped.is_loopback)):
    raise RuntimeError("Unexpected QA server/database")
os.environ.pop("TW_V2_DATABASE_URL", None)
sys.path[:0] = [str(repo / "foundation_v2"), str(repo)]
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization

app = create_app(
    dsn=dsn,
    artifact_root=workspace / ".artifacts/wm-integration-20261001/data",
    authorization=LocalWorkspaceAuthorization.for_local_owner(["tenant-a"], identity_id="local-owner"),
    learn_roots={},
)

@app.middleware("http")
async def read_only(request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        return JSONResponse({"detail": "qa_read_only"}, status_code=403)
    return await call_next(request)

print(f"QA readonly PID={os.getpid()} database={database} broker=locked", flush=True)
uvicorn.run(app, host="127.0.0.1", port=8020, reload=False)
