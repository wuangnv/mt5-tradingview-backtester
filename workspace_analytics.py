"""R2 analytics routes registered only on the integrated workspace."""

import csv
import io
import json

from flask import Response, jsonify, request

from analytics_read_model import AnalyticsReadModel, AnalyticsValidationError


def _csv_safe(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    if isinstance(value, str) and value[:1] in {"=", "+", "-", "@"}:
        return "'" + value
    return value


def register_analytics_routes(app):
    read_model = AnalyticsReadModel(app.config["EVIDENCE_STORE"])
    app.config["ANALYTICS_READ_MODEL"] = read_model

    @app.errorhandler(AnalyticsValidationError)
    def handle_analytics_invalid(error):
        return jsonify({"success": False, "error": {"code": error.code, "message": str(error)}}), 400

    @app.get("/api/analytics/runs/<run_id>")
    def analytics_run(run_id):
        return jsonify({"success": True, "analytics": read_model.run_view(run_id, request.args)})

    @app.get("/api/analytics/runs/<run_id>/export.json")
    def analytics_export_json(run_id):
        view = read_model.run_view(run_id, request.args)
        return Response(
            json.dumps(view, ensure_ascii=True, indent=2, allow_nan=False),
            mimetype="application/json",
            headers={"Content-Disposition": f'attachment; filename="run-{run_id}-analytics-v2.json"'},
        )

    @app.get("/api/analytics/runs/<run_id>/export.csv")
    def analytics_export_csv(run_id):
        view = read_model.run_view(run_id, request.args)
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["section", "field", "value"])
        for field, value in view["scope"].items():
            writer.writerow(["scope", field, _csv_safe(value)])
        for field, value in view["metrics"].items():
            if field not in {"closed_trade_balance_curve", "closed_trade_balance_drawdown_curve", "realized_r_values", "definitions"}:
                writer.writerow(["metrics", field, _csv_safe(value)])
        writer.writerow([])
        ledger_fields = [
            "trade_id", "open_time_utc", "close_time_utc", "symbol", "side", "quantity",
            "price_open", "price_close", "gross_pnl", "fees", "net_pnl", "planned_risk_budget",
            "realized_r", "legacy_r", "legacy_result",
        ]
        writer.writerow(ledger_fields)
        for trade in view["ledger"]:
            writer.writerow([_csv_safe(trade.get(field)) for field in ledger_fields])
        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="run-{run_id}-analytics-v2.csv"'},
        )

    @app.get("/api/analytics/compare")
    def analytics_compare():
        run_ids = request.args.getlist("run_id")
        return jsonify({"success": True, "comparison": read_model.compare(run_ids, request.args)})
