"""R3 Probability / Risk Lab routes for the integrated workspace."""

from flask import jsonify, render_template, request

from prop_profile import evaluate_prop_profile
from risk_lab import (
    RiskLabValidationError,
    breakeven_win_rate,
    compounded_loss_scenario,
    streak_scenario,
)
from risk_bootstrap import (
    RiskLabCancelled,
    RiskLabInsufficientData,
    block_bootstrap_simulation,
    bootstrap_eligibility,
)


def register_risk_lab_routes(app):
    @app.errorhandler(RiskLabValidationError)
    def handle_risk_lab_invalid(error):
        status = 422 if isinstance(error, RiskLabInsufficientData) else 400
        return jsonify({"success": False, "error": {"code": error.code, "message": str(error)}}), status

    @app.errorhandler(RiskLabCancelled)
    def handle_risk_lab_cancelled(error):
        return jsonify({"success": False, "error": {"code": error.code, "message": str(error)}}), 409

    def payload():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise RiskLabValidationError("request body must be a JSON object")
        return value

    @app.get("/risk-lab")
    def risk_lab_page():
        return render_template("risk_lab.html")

    @app.post("/api/risk-lab/streak")
    def risk_lab_streak():
        value = payload()
        result = streak_scenario(
            value.get("loss_probability"),
            value.get("streak_length"),
            value.get("horizon"),
        )
        return jsonify({"success": True, "scenario": result})

    @app.post("/api/risk-lab/equity")
    def risk_lab_equity():
        value = payload()
        result = compounded_loss_scenario(
            value.get("starting_equity"),
            value.get("risk_fraction"),
            value.get("losses"),
        )
        return jsonify({"success": True, "scenario": result})

    @app.post("/api/risk-lab/breakeven")
    def risk_lab_breakeven():
        value = payload()
        result = breakeven_win_rate(
            value.get("win_payoff"),
            value.get("loss_amount"),
            value.get("extra_cost", 0),
            value.get("win_probability"),
        )
        return jsonify({"success": True, "scenario": result})

    @app.get("/api/risk-lab/bootstrap/eligibility/<run_id>")
    def risk_lab_bootstrap_eligibility(run_id):
        store = app.config["EVIDENCE_STORE"]
        run = store.get_run(run_id)
        ledger = store.get_ledger(run_id)
        return jsonify({"success": True, "eligibility": bootstrap_eligibility(run, ledger)})

    @app.post("/api/risk-lab/bootstrap")
    def risk_lab_bootstrap():
        value = payload()
        run_id = value.get("run_id")
        if run_id in (None, ""):
            raise RiskLabValidationError("run_id is required")
        store = app.config["EVIDENCE_STORE"]
        run = store.get_run(run_id)
        ledger = store.get_ledger(run_id)
        result = block_bootstrap_simulation(
            run,
            ledger,
            seed=value.get("seed", 1),
            path_count=value.get("path_count", 1000),
            horizon=value.get("horizon", len(ledger)),
            breach_drawdown_fraction=value.get("breach_drawdown_fraction", 0.10),
        )
        return jsonify({"success": True, "simulation": result})

    @app.post("/api/risk-lab/prop-profile/evaluate")
    def risk_lab_prop_profile():
        value = payload()
        result = evaluate_prop_profile(value.get("profile"), value.get("snapshot"))
        return jsonify({"success": True, "evaluation": result})
