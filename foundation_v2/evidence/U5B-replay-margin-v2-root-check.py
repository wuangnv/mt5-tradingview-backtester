"""Reproduce the core/service slice without database or application network access."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import socket
import sys
from unittest.mock import patch

import pytest


ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
receipt = json.loads((ROOT / "foundation_v2/evidence/U5B-replay-margin-v2-validation-r1.json").read_text())
drift = [name for name, expected in receipt["source_after"].items()
         if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected]
if drift:
    raise RuntimeError(f"Frozen source drift: {drift}")
for name in ("TW_V2_DATABASE_URL", "TW_TEST_DATABASE_URL", "DATABASE_URL", "PGDATABASE", "PGHOST"):
    os.environ.pop(name, None)

connect = socket.socket.connect
socketpair_code = socket.socketpair.__code__
counts = {"application_blocks": 0, "stdlib_socketpair_exemptions": 0}


def deny(*args, **kwargs):
    counts["application_blocks"] += 1
    raise RuntimeError("Application network is denied in margin root check")


def checked_connect(sock, address):
    # Windows asyncio creates a loopback self-pipe through this exact stdlib
    # function; application loopback connections remain denied.
    if (sys._getframe(1).f_code is socketpair_code and isinstance(address, tuple)
            and address[0] in {"127.0.0.1", "::1"}):
        counts["stdlib_socketpair_exemptions"] += 1
        return connect(sock, address)
    return deny(sock, address)


with patch.object(socket.socket, "connect", checked_connect), \
        patch.object(socket.socket, "connect_ex", deny), \
        patch.object(socket.socket, "sendto", deny), \
        patch.object(socket, "create_connection", deny):
    for address in (("127.0.0.1", 8020), ("203.0.113.1", 443)):
        with socket.socket() as probe:
            try:
                probe.connect(address)
            except RuntimeError:
                pass
            else:
                raise RuntimeError("Network denial self-check failed")
    result = pytest.main(["-q", "foundation_v2/tests/test_replay_margin_v2.py",
                          "foundation_v2/tests/test_replay_margin_v2_service.py"])
print(json.dumps({"pytest_exit": result, "source_drift": drift, "network_guard": counts,
                  "scope": "synthetic memory store and in-process ASGI; no database/native subprocess"}))
raise SystemExit(result)
