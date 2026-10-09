import json
import threading
import time

import pytest

from trading_workspace_v2 import worker


def test_persistent_worker_keeps_polling_after_fenced_job_failure_and_closes(monkeypatch,tmp_path,capsys):
    states = {"calls":0,"closed":False}

    class Store:
        def __init__(self,*args): pass
        def initialize(self): pass
        def close(self): states["closed"] = True

    class Service:
        def __init__(self,*args,**kwargs): pass
        def run_one(self):
            states["calls"] += 1
            if states["calls"] == 1:
                raise RuntimeError("sensitive exception details must not be logged")
            raise KeyboardInterrupt()

    monkeypatch.setattr(worker,"PostgresStore",Store)
    monkeypatch.setattr(worker,"ResearchService",Service)
    monkeypatch.setattr(worker,"_wait_idle",lambda *_: None)
    monkeypatch.delenv("TW_V2_SHUTDOWN_FILE",raising=False)
    monkeypatch.setenv("TW_V2_DATABASE_URL","test-owned-fake")
    monkeypatch.setenv("TW_V2_ARTIFACT_ROOT",str(tmp_path))
    monkeypatch.setattr("sys.argv",["worker"])
    assert worker.main() == 0
    assert states == {"calls":2,"closed":True}
    assert json.loads(capsys.readouterr().out) == {"event":"worker_attempt_failed","error_type":"RuntimeError"}


@pytest.mark.parametrize("idle",[False,True])
def test_shutdown_marker_drains_between_jobs_or_interrupts_idle_wait(monkeypatch,tmp_path,idle):
    states = {"calls":0,"closed":False}
    marker = tmp_path / "shutdown"

    class Store:
        def __init__(self,*args): pass
        def initialize(self): pass
        def close(self): states["closed"] = True

    class Service:
        def __init__(self,*args,**kwargs): pass
        def run_one(self):
            states["calls"] += 1
            assert states["calls"] == 1
            if not idle:
                marker.write_text("stop")
                return object()
            threading.Timer(.05,lambda: marker.write_text("stop")).start()
            return None

    monkeypatch.setattr(worker,"PostgresStore",Store)
    monkeypatch.setattr(worker,"ResearchService",Service)
    monkeypatch.setenv("TW_V2_DATABASE_URL","test-owned-fake")
    monkeypatch.setenv("TW_V2_ARTIFACT_ROOT",str(tmp_path))
    monkeypatch.setenv("TW_V2_SHUTDOWN_FILE",str(marker))
    monkeypatch.setattr("sys.argv",["worker","--poll-seconds","30"])
    started = time.monotonic()
    assert worker.main() == 0
    assert time.monotonic() - started < 1
    assert states == {"calls":1,"closed":True}
