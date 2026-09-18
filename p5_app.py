"""P5 read-only live-readiness shell.

P4 execution remains demo-only. This module exposes one local GET endpoint for
live readiness and deliberately does not add a live execution route.
"""

import os
from urllib.parse import urlsplit

from flask import jsonify, request

from demo_broker import DemoBrokerSimulator
from execution_service import ExecutionService
from execution_store import ExecutionJournal
from live_readiness import LivePolicy, MT5LiveReadinessProbe
from p4_app import create_app as create_trade_app


def _csv(value):
    return tuple(item.strip() for item in str(value or "").split(",") if item.strip())


def _policy_from_env():
    return LivePolicy(
        expected_account_id=os.environ.get("P5_EXPECTED_ACCOUNT_ID", ""),
        expected_server=os.environ.get("P5_EXPECTED_ACCOUNT_SERVER", ""),
        max_risk_pct=os.environ.get("P5_MAX_RISK_PCT", ""),
        max_risk_amount=os.environ.get("P5_MAX_RISK_AMOUNT", ""),
        max_positions=os.environ.get("P5_MAX_POSITIONS", ""),
        allowed_actions=_csv(os.environ.get("P5_ALLOWED_ACTIONS")),
        allowed_symbols=_csv(os.environ.get("P5_ALLOWED_SYMBOLS")),
    )


def _default_live_probe():
    backend = str(os.environ.get("P5_READINESS_BACKEND") or "disabled").strip().lower()
    if backend == "disabled":
        return None
    if backend == "mt5-readonly":
        from mt5_data import mt5_fetcher

        return MT5LiveReadinessProbe(mt5_fetcher)
    raise RuntimeError(f"unsupported P5 readiness backend {backend!r}")


def _disabled_state(policy):
    return {
        "phase": "P5A",
        "probe": "disabled",
        "read_only": True,
        "execution_enabled": False,
        "ready_for_live_gate": False,
        "blockers": ["P5 read-only readiness backend is disabled"],
        "protocol_version": 0,
        "connection": {"connected": False},
        "account": {
            "account_id": "",
            "server": "",
            "mode": "",
            "currency": None,
            "company": None,
        },
        "positions": [],
        "unknown_live_requests": [],
        "policy": policy.normalized(),
    }


def create_app(
    evidence_db_path=None,
    research_db_path=None,
    journal_db_path=None,
    history_root=None,
    execution_db_path=None,
    *,
    execution_service=None,
    demo_adapter=None,
    live_probe=None,
    live_policy=None,
):
    if execution_service is None:
        adapter = demo_adapter or DemoBrokerSimulator()
        execution_service = ExecutionService(
            adapter, ExecutionJournal(execution_db_path)
        )
    app = create_trade_app(
        evidence_db_path,
        research_db_path,
        journal_db_path,
        history_root,
        execution_db_path,
        execution_service=execution_service,
        demo_adapter=demo_adapter,
    )
    app.config["LIVE_READINESS_PROBE"] = (
        live_probe if live_probe is not None else _default_live_probe()
    )
    app.config["LIVE_READINESS_POLICY"] = live_policy or _policy_from_env()
    app.config["LIVE_READINESS_JOURNAL"] = app.config["EXECUTION_SERVICE"].journal

    @app.before_request
    def protect_live_readiness_route():
        if not request.path.startswith("/api/live-readiness/"):
            return None
        if request.remote_addr not in {"127.0.0.1", "::1"}:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": {
                            "code": "LOCAL_ONLY",
                            "message": "live readiness API is local-only",
                        },
                    }
                ),
                403,
            )
        host = (urlsplit(f"//{request.host}").hostname or "").lower()
        if host not in {"127.0.0.1", "localhost", "::1"}:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": {
                            "code": "LOCAL_ONLY",
                            "message": "live readiness API requires a loopback host",
                        },
                    }
                ),
                403,
            )
        return None

    @app.get("/api/live-readiness/state")
    def live_readiness_state():
        probe = app.config["LIVE_READINESS_PROBE"]
        policy = app.config["LIVE_READINESS_POLICY"]
        if probe is None:
            state = _disabled_state(policy)
        else:
            state = probe.snapshot(policy, app.config["LIVE_READINESS_JOURNAL"])
        return jsonify({"success": True, "state": state})

    return app


app = create_app(
    os.environ.get("EVIDENCE_DB_PATH"),
    os.environ.get("RESEARCH_DB_PATH"),
    os.environ.get("JOURNAL_DB_PATH"),
    os.environ.get("HISTORY_CHUNKS_PATH"),
    os.environ.get("EXECUTION_DB_PATH"),
)


if __name__ == "__main__":
    port = int(os.environ.get("P5_READINESS_PORT", "5005"))
    app.run(host="127.0.0.1", port=port, debug=False)
