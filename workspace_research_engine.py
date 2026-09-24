"""Automatic local research-run execution routes."""

from flask import jsonify

from research_engine import ResearchEngineDataDenied, ResearchEngineError, ResearchEngineValidationError
from research_validation import (
    ResearchReconciliationError,
    research_analytics_report,
    validate_research_run,
)


def register_research_engine_routes(app, runner):
    app.config["RESEARCH_ENGINE_RUNNER"] = runner

    def error(code, message, status):
        return jsonify({"success": False, "error": {"code": code, "message": message}}), status

    @app.errorhandler(ResearchEngineDataDenied)
    def handle_engine_data_denied(exc):
        return error(exc.code, str(exc), 403)

    @app.errorhandler(ResearchEngineValidationError)
    def handle_engine_invalid(exc):
        return error(exc.code, str(exc), 422)

    @app.errorhandler(ResearchEngineError)
    def handle_engine_error(exc):
        return error(exc.code, str(exc), 500)

    @app.errorhandler(ResearchReconciliationError)
    def handle_reconciliation_error(exc):
        return error(exc.code, str(exc), 409)

    @app.post("/api/research/runs/<run_id>/execute")
    def execute_research_run(run_id):
        run = runner.execute(run_id)
        return jsonify({"success": True, "run": run})

    @app.get("/api/research/runs/<run_id>/validation")
    def validate_research_run_route(run_id):
        report = validate_research_run(runner.research_store, run_id)
        return jsonify({"success": True, "validation": report})

    @app.get("/api/research/runs/<run_id>/analytics")
    def research_run_analytics(run_id):
        run = runner.research_store.get_run(run_id)
        if run.get("status") != "completed":
            validate_research_run(runner.research_store, run_id)
        return jsonify({"success": True, "analytics": research_analytics_report(run.get("result"))})
