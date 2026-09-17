"""P4 local Trade Desk shell backed only by the deterministic demo simulator."""

import os
from urllib.parse import urlsplit

from flask import jsonify, render_template, request

from demo_broker import DemoBrokerSimulator
from execution_service import (
    ExecutionContext,
    ExecutionDenied,
    ExecutionError,
    ExecutionIntentConflict,
    ExecutionRiskDenied,
    ExecutionService,
    ExecutionUnknown,
    ExecutionValidationError,
)
from execution_store import ExecutionJournal, ExecutionStoreError
from p3_app import create_app as create_practice_app


def create_app(
    evidence_db_path=None,
    research_db_path=None,
    journal_db_path=None,
    history_root=None,
    execution_db_path=None,
    *,
    execution_service=None,
    demo_adapter=None,
):
    app = create_practice_app(
        evidence_db_path,
        research_db_path,
        journal_db_path,
        history_root,
    )
    adapter = demo_adapter or DemoBrokerSimulator()
    app.config["EXECUTION_SERVICE"] = execution_service or ExecutionService(
        adapter,
        ExecutionJournal(execution_db_path),
    )

    def error_response(code, message, status):
        return jsonify({"success": False, "error": {"code": code, "message": message}}), status

    @app.errorhandler(ExecutionValidationError)
    def handle_execution_invalid(error):
        return error_response(error.code, str(error), 422)

    @app.errorhandler(ExecutionRiskDenied)
    def handle_execution_risk(error):
        return error_response(error.code, str(error), 409)

    @app.errorhandler(ExecutionDenied)
    def handle_execution_denied(error):
        return error_response(error.code, str(error), 403)

    @app.errorhandler(ExecutionIntentConflict)
    def handle_execution_conflict(error):
        return error_response(error.code, str(error), 409)

    @app.errorhandler(ExecutionUnknown)
    def handle_execution_unknown(error):
        return error_response(error.code, str(error), 503)

    @app.errorhandler(ExecutionStoreError)
    def handle_execution_store(error):
        return error_response(error.code, str(error), 500)

    @app.errorhandler(ExecutionError)
    def handle_execution_error(error):
        return error_response(error.code, str(error), 500)

    @app.before_request
    def protect_execution_routes():
        if not request.path.startswith("/api/execution/"):
            return None
        if request.remote_addr not in {"127.0.0.1", "::1"}:
            return error_response("LOCAL_ONLY", "execution API is local-only", 403)
        host = (urlsplit(f"//{request.host}").hostname or "").lower()
        if host not in {"127.0.0.1", "localhost", "::1"}:
            return error_response("LOCAL_ONLY", "execution API requires a loopback host", 403)
        if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
            origin = request.headers.get("Origin")
            if origin:
                parsed_origin = urlsplit(origin)
                origin_host = (parsed_origin.hostname or "").lower()
                if (
                    parsed_origin.scheme != "http"
                    or origin_host not in {"127.0.0.1", "localhost", "::1"}
                    or parsed_origin.netloc.lower() != request.host.lower()
                ):
                    return error_response("ORIGIN_DENIED", "execution API origin is not allowed", 403)
        return None

    def payload():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise ExecutionValidationError("request body must be a JSON object")
        return value

    def confirmed_payload():
        if request.headers.get("X-Execution-Intent") != "confirmed":
            raise ExecutionDenied("explicit execution confirmation header is required")
        return payload()

    @app.get("/trade-desk")
    def trade_desk():
        return render_template("trade_desk.html")

    @app.get("/api/execution/state")
    def execution_state():
        return jsonify({"success": True, "state": app.config["EXECUTION_SERVICE"].snapshot()})

    @app.post("/api/execution/preview")
    def execution_preview():
        preview = app.config["EXECUTION_SERVICE"].preview(payload().get("order"))
        return jsonify({"success": True, "preview": preview})

    @app.post("/api/execution/orders")
    def execution_place():
        value = confirmed_payload()
        context = ExecutionContext(
            mode=value.get("mode"),
            account_id=value.get("account_id"),
            request_id=value.get("request_id"),
        )
        result = app.config["EXECUTION_SERVICE"].place(context, value.get("order"))
        return jsonify({"success": True, "result": result}), 201

    @app.post("/api/execution/positions/<position_id>/close")
    def execution_close(position_id):
        value = confirmed_payload()
        context = ExecutionContext(
            mode=value.get("mode"),
            account_id=value.get("account_id"),
            request_id=value.get("request_id"),
        )
        result = app.config["EXECUTION_SERVICE"].close(context, position_id)
        return jsonify({"success": True, "result": result})

    @app.post("/api/execution/requests/<request_id>/reconcile")
    def execution_reconcile(request_id):
        confirmed_payload()
        result = app.config["EXECUTION_SERVICE"].reconcile(request_id)
        return jsonify({"success": True, "result": result})

    return app


app = create_app(
    os.environ.get("EVIDENCE_DB_PATH"),
    os.environ.get("RESEARCH_DB_PATH"),
    os.environ.get("JOURNAL_DB_PATH"),
    os.environ.get("HISTORY_CHUNKS_PATH"),
    os.environ.get("EXECUTION_DB_PATH"),
)


if __name__ == "__main__":
    port = int(os.environ.get("TRADE_DESK_PORT", "5004"))
    app.run(host="127.0.0.1", port=port, debug=False)
