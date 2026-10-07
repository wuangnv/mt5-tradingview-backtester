"""Independent cache and transport checks; all transport mocked and caches in evidence."""
import hashlib
import json
import sys
import threading
import time
from pathlib import Path

import httpx

base = Path(__file__).resolve().parent
sys.path[:0] = [str(base.parents[2]), str(base.parents[3])]
from trading_workspace_v2.dukascopy_catalog import DukascopyCatalog, MAX_BYTES

report = {"cases": []}
key = "independent-dummy-key"
path = base / "fixture-backend-cache.json"

def run(name, fn):
    try:
        result = fn()
        report["cases"].append({"name": name, "pass": True, "evidence": result})
    except Exception as exc:
        report["cases"].append({"name": name, "pass": False, "error": repr(exc)})

def no_key():
    def forbidden(_):
        raise AssertionError("must not request")
    with httpx.Client(transport=httpx.MockTransport(forbidden)) as client:
        catalog = DukascopyCatalog(path, client=client)
        catalog.refresh()
        assert catalog.status()["error"] == "missing_key"
        assert catalog.list_instruments("qa") == []
    return "missing_key without HTTP"

def sanitized_cache():
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=[{"name": "eur/usd", "nameLong": "Euro ドル", "extra_secret": key}]))) as client:
        catalog = DukascopyCatalog(path, key, client=client)
        catalog.refresh()
        assert catalog.status()["item_count"] == 1
        persisted = path.read_text(encoding="utf8")
        assert key not in persisted and "extra_secret" not in persisted and '"items"' not in persisted
        loaded = DukascopyCatalog(path, client=client)
        assert loaded.list_instruments("qa")[0]["instrument_id"] == "EUR/USD"
        assert loaded.status()["error"] is None
        assert catalog.capabilities["read_metadata"]
        assert not any(v for k, v in catalog.capabilities.items() if k != "read_metadata")
    return "sanitized UTF8 public fields, cache reload, metadata-only"

def concurrency():
    entered, release = threading.Event(), threading.Event()
    requests = []
    def held(request):
        requests.append(request.url.host)
        entered.set()
        assert release.wait(3)
        return httpx.Response(200, json=[{"name":"XAU/USD"}])
    with httpx.Client(transport=httpx.MockTransport(held)) as client:
        catalog = DukascopyCatalog(path, key, client=client)
        first = threading.Thread(target=catalog.refresh)
        second = threading.Thread(target=catalog.refresh)
        first.start()
        assert entered.wait(1)
        second.start()
        start = time.perf_counter()
        old = catalog.status()
        items = catalog.list_instruments("qa")
        latency = time.perf_counter()-start
        assert latency < .2 and old["status"] == "cached" and items[0]["instrument_id"] == "EUR/USD"
        release.set()
        first.join(3)
        second.join(3)
        assert not first.is_alive() and not second.is_alive()
        assert len(requests) == 1
        assert catalog.status()["item_count"] == 1
    return {"cached_read_seconds":latency,"mock_request_count":len(requests)}

def preserves_errors():
    outcomes = []
    for status, content, expected in [(403,b"key rejected", "key_rejected"),(429,b"rate limited","rate_limited"),(302,b"redirect","source_unavailable"),(503,b"unavailable","source_unavailable"),(200,b"not JSON","invalid_response"),(200,b"[]","invalid_response"),(200,b"x"*(MAX_BYTES+1),"invalid_response")]:
        requests=[]
        def mocked(request):
            requests.append(request.url.host)
            return httpx.Response(status,content=content)
        with httpx.Client(transport=httpx.MockTransport(mocked)) as client:
            catalog = DukascopyCatalog(path,key,client=client)
            before = catalog.list_instruments("qa")
            catalog.refresh()
            state = catalog.status()
            assert state["error"] == expected and state["status"] == "cached"
            assert catalog.list_instruments("qa") == before
            assert key not in json.dumps(state)
            catalog.refresh()
            assert len(requests)==1
            if status==429:
                assert state["retry_after_seconds"] >= 299
            outcomes.append({"http":status,"error":expected,"cached_count":state["item_count"]})
    return outcomes

def corruption():
    original = path.read_bytes()
    snapshot = json.loads(original)
    snapshot["sha256"] = "invalid"
    path.write_text(json.dumps(snapshot))
    invalid = DukascopyCatalog(path)
    assert invalid.status()["error"] == "invalid_cache"
    assert invalid.list_instruments("qa") == []
    path.write_bytes(original)
    return "corrupt digest rejected without network"

try:
    path.unlink(missing_ok=True)
    run("missing-key",no_key)
    run("sanitize-reload-capabilities",sanitized_cache)
    run("concurrent-refresh-cached-get",concurrency)
    run("error-cooldown-retains-cache",preserves_errors)
    run("corrupt-cache",corruption)
finally:
    path.unlink(missing_ok=True)
    report["pass"] = all(c["pass"] for c in report["cases"])
    report["source_sha256"] = hashlib.sha256((base.parents[2]/"trading_workspace_v2/dukascopy_catalog.py").read_bytes()).hexdigest()
    (base/"backend-probe.json").write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
