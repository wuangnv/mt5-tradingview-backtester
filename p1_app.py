"""Read-only Flask shell for the P1 Evidence Explorer."""

import csv
import io
import json
import os

from flask import Flask, Response, jsonify, render_template, request

from evidence_store import (
    EvidenceInvalid,
    EvidenceNotFound,
    EvidenceReconciliationMismatch,
    EvidenceSchemaUnsupported,
    EvidenceStore,
    EvidenceStoreError,
)


def _csv_safe(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    if isinstance(value, str) and value[:1] in {"=", "+", "-", "@"}:
        return "'" + value
    return value


def create_app(db_path=None, store=None):
    app = Flask(__name__)
    app.config["EVIDENCE_STORE"] = store or EvidenceStore(db_path)

    @app.after_request
    def evidence_headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "script-src 'self'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "base-uri 'none'; "
            "frame-ancestors 'none'"
        )
        return response

    def error_response(code, message, status):
        return jsonify({"success": False, "error": {"code": code, "message": message}}), status

    @app.errorhandler(EvidenceNotFound)
    def handle_not_found(error):
        return error_response(error.code, str(error), 404)

    @app.errorhandler(EvidenceInvalid)
    def handle_invalid(error):
        return error_response(error.code, str(error), 422)

    @app.errorhandler(EvidenceSchemaUnsupported)
    def handle_schema_unsupported(error):
        return error_response(error.code, str(error), 422)

    @app.errorhandler(EvidenceReconciliationMismatch)
    def handle_reconciliation_mismatch(error):
        return error_response(error.code, str(error), 409)

    @app.errorhandler(EvidenceStoreError)
    def handle_read_failure(error):
        return error_response(error.code, str(error), 503)

    @app.get("/")
    def evidence_explorer():
        return render_template("evidence.html")

    @app.get("/api/runs")
    def list_runs():
        try:
            limit = int(request.args.get("limit", 50))
        except (TypeError, ValueError):
            return error_response("INVALID_REQUEST", "limit must be an integer", 400)
        if limit < 1 or limit > 100:
            return error_response("INVALID_REQUEST", "limit must be between 1 and 100", 400)
        runs = app.config["EVIDENCE_STORE"].list_runs(limit)
        return jsonify({"success": True, "runs": runs})

    @app.get("/api/runs/<run_id>")
    def run_detail(run_id):
        run = app.config["EVIDENCE_STORE"].get_run(run_id)
        return jsonify({"success": True, "run": run})

    @app.get("/api/runs/<run_id>/ledger")
    def run_ledger(run_id):
        ledger = app.config["EVIDENCE_STORE"].get_ledger(run_id)
        return jsonify(
            {
                "success": True,
                "run_id": str(run_id),
                "artifact_schema_version": "legacy-replay-session-v1",
                "trades": ledger,
            }
        )

    @app.get("/api/runs/<run_id>/metrics")
    def run_metrics(run_id):
        metrics = app.config["EVIDENCE_STORE"].get_metrics(run_id)
        return jsonify({"success": True, "run_id": str(run_id), "metrics": metrics})

    @app.get("/api/runs/<run_id>/equity")
    def run_equity(run_id):
        metrics = app.config["EVIDENCE_STORE"].get_metrics(run_id)
        return jsonify(
            {
                "success": True,
                "run_id": str(run_id),
                "metric_schema_version": metrics["metric_schema_version"],
                "equity_curve": metrics["equity_curve"],
            }
        )

    @app.get("/api/runs/<run_id>/trades/<trade_id>")
    def run_trade(run_id, trade_id):
        trade = app.config["EVIDENCE_STORE"].get_trade(run_id, trade_id)
        return jsonify({"success": True, "run_id": str(run_id), "trade": trade})

    @app.get("/api/runs/<run_id>/export.json")
    def export_json(run_id):
        bundle = app.config["EVIDENCE_STORE"].build_evidence_bundle(run_id)
        payload = json.dumps(bundle, ensure_ascii=True, indent=2, allow_nan=False)
        return Response(
            payload,
            mimetype="application/json",
            headers={"Content-Disposition": f'attachment; filename="run-{run_id}-evidence.json"'},
        )

    @app.get("/api/runs/<run_id>/export.csv")
    def export_csv(run_id):
        bundle = app.config["EVIDENCE_STORE"].build_evidence_bundle(run_id)
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["section", "field", "value"])
        run = bundle["run"]
        metrics = bundle["metrics"]
        sections = (
            (
                "run",
                run,
                (
                    "run_id",
                    "artifact_schema_version",
                    "created_at_utc",
                    "status",
                    "halt_reason",
                    "strategy_id",
                    "strategy_version",
                    "starting_balance",
                ),
            ),
            (
                "data",
                run.get("data", {}),
                (
                    "symbol",
                    "timeframe",
                    "bars_replayed",
                    "dataset_id",
                    "source_id",
                    "requested_range",
                    "observed_range",
                    "timezone",
                    "coverage",
                    "quality_status",
                ),
            ),
            (
                "assumptions",
                run.get("assumptions", {}),
                (
                    "cost_model_version",
                    "spread",
                    "slippage",
                    "commission",
                    "fill_model_version",
                    "risk_model_version",
                ),
            ),
            (
                "reproduce",
                run.get("reproduce", {}),
                (
                    "engine_version",
                    "metric_version",
                    "code_hash",
                    "config_hash",
                    "seed",
                ),
            ),
            (
                "comparison",
                run.get("comparison", {}),
                ("ready", "reasons"),
            ),
        )
        for section, values, fields in sections:
            for field in fields:
                writer.writerow([section, field, _csv_safe(values.get(field))])
        for field, value in metrics.items():
            if field != "equity_curve":
                writer.writerow(["metrics", field, _csv_safe(value)])

        writer.writerow([])
        ledger_fields = [
            "trade_id",
            "open_time_utc",
            "close_time_utc",
            "symbol",
            "side",
            "quantity",
            "price_open",
            "price_close",
            "gross_pnl",
            "fees",
            "net_pnl",
            "planned_risk_budget",
            "realized_r",
            "legacy_r",
            "legacy_result",
        ]
        writer.writerow(ledger_fields)
        for trade in bundle["ledger"]:
            writer.writerow([_csv_safe(trade.get(field)) for field in ledger_fields])

        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="run-{run_id}-evidence.csv"'},
        )

    return app


app = create_app(os.environ.get("EVIDENCE_DB_PATH"))


if __name__ == "__main__":
    port = int(os.environ.get("EVIDENCE_PORT", "5001"))
    app.run(host="127.0.0.1", port=port, debug=False)
