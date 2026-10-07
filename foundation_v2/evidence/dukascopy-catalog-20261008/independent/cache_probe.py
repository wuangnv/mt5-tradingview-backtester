"""Independent isolated transport/cache probes. No external calls or user DB."""
import json
import sys
from pathlib import Path

import httpx

base = Path(__file__).resolve().parent
sys.path.insert(0, str(base.parents[2]))
sys.path.insert(0, str(base.parents[3]))
from trading_workspace_v2.dukascopy_catalog import DukascopyCatalog, MAX_BYTES

payload = [{"name": f"SYM{i:05}", "nameLong": "x" * 240} for i in range(5000)]
raw = json.dumps(payload).encode()
requests = []

def handle(request):
    requests.append({"method": request.method, "host": request.url.host})
    return httpx.Response(200, content=raw)

with httpx.Client(transport=httpx.MockTransport(handle)) as client:
    path = base / "fixture-large-cache.json"
    path.unlink(missing_ok=True)
    catalog = DukascopyCatalog(path, "independent-fixture-key", client=client)
    catalog.refresh()
    before = catalog.status()
    size = path.stat().st_size
    loaded = DukascopyCatalog(path, client=client)
    assert len(raw) < MAX_BYTES
    assert size <= MAX_BYTES
    assert loaded.status()["item_count"] == 5000
    assert loaded.status()["error"] is None
    result = {"raw_bytes": len(raw), "max_bytes": MAX_BYTES, "cache_bytes": size,
              "before": before, "after_reload": loaded.status(), "mock_requests": requests}
    (base / "cache-probe.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    path.unlink()
