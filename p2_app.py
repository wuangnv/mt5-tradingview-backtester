"""P2 local research workspace layered on the P1 read-only evidence shell."""

import os

from flask import jsonify, render_template, request

from p1_app import create_app as create_evidence_app
from research_store import (
    ResearchConflict,
    ResearchError,
    ResearchNotFound,
    ResearchStore,
    ResearchValidationError,
)


def create_app(evidence_db_path=None, research_db_path=None, evidence_store=None, research_store=None):
    app = create_evidence_app(evidence_db_path, store=evidence_store)
    app.config["RESEARCH_STORE"] = research_store or ResearchStore(research_db_path)

    def error_response(code, message, status):
        return jsonify({"success": False, "error": {"code": code, "message": message}}), status

    @app.errorhandler(ResearchNotFound)
    def handle_research_not_found(error):
        return error_response(error.code, str(error), 404)

    @app.errorhandler(ResearchValidationError)
    def handle_research_invalid(error):
        return error_response(error.code, str(error), 422)

    @app.errorhandler(ResearchConflict)
    def handle_research_conflict(error):
        return error_response(error.code, str(error), 409)

    @app.errorhandler(ResearchError)
    def handle_research_error(error):
        return error_response(error.code, str(error), 500)

    def payload():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise ResearchValidationError("request body must be a JSON object")
        return value

    @app.get("/research")
    def research_workspace():
        return render_template("research.html")

    @app.get("/api/research")
    def research_snapshot():
        return jsonify({"success": True, "workspace": app.config["RESEARCH_STORE"].snapshot()})

    @app.post("/api/research/hypotheses")
    def create_hypothesis():
        item = app.config["RESEARCH_STORE"].create_hypothesis(payload())
        return jsonify({"success": True, "hypothesis": item}), 201

    @app.post("/api/research/strategy-versions")
    def create_strategy_version():
        item = app.config["RESEARCH_STORE"].create_strategy_version(payload())
        return jsonify({"success": True, "strategy_version": item}), 201

    @app.post("/api/research/protocols")
    def create_protocol():
        item = app.config["RESEARCH_STORE"].create_protocol(payload())
        return jsonify({"success": True, "protocol": item}), 201

    @app.post("/api/research/runs")
    def create_run():
        item = app.config["RESEARCH_STORE"].create_run(payload())
        return jsonify({"success": True, "run": item}), 201

    @app.get("/api/research/runs/<run_id>")
    def research_run_detail(run_id):
        item = app.config["RESEARCH_STORE"].get_run(run_id)
        return jsonify({"success": True, "run": item})

    @app.post("/api/research/runs/<run_id>/start")
    def start_run(run_id):
        item = app.config["RESEARCH_STORE"].start_run(run_id)
        return jsonify({"success": True, "run": item})

    @app.post("/api/research/runs/<run_id>/complete")
    def complete_run(run_id):
        item = app.config["RESEARCH_STORE"].complete_run(run_id, payload())
        return jsonify({"success": True, "run": item})

    @app.post("/api/research/runs/<run_id>/fail")
    def fail_run(run_id):
        item = app.config["RESEARCH_STORE"].fail_run(run_id, payload().get("reason"))
        return jsonify({"success": True, "run": item})

    @app.post("/api/research/runs/<run_id>/cancel")
    def cancel_run(run_id):
        item = app.config["RESEARCH_STORE"].cancel_run(run_id, payload().get("reason"))
        return jsonify({"success": True, "run": item})

    return app


app = create_app(os.environ.get("EVIDENCE_DB_PATH"), os.environ.get("RESEARCH_DB_PATH"))


if __name__ == "__main__":
    port = int(os.environ.get("RESEARCH_PORT", "5002"))
    app.run(host="127.0.0.1", port=port, debug=False)
