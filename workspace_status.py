"""Machine-readable integration status for the supported local workspace."""

import sqlite3
from pathlib import Path

from flask import jsonify

from workspace_storage import DATABASES


def _database_versions(root):
    versions = {}
    for name in DATABASES:
        path = Path(root) / name
        if not path.is_file():
            versions[name] = None
            continue
        uri = f"file:{path.resolve().as_posix()}?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=5)
        try:
            versions[name] = int(connection.execute("PRAGMA user_version").fetchone()[0])
        finally:
            connection.close()
    return versions


def build_workspace_status(app):
    ai = app.config["AI_SERVICE"].status()
    execution = app.config["EXECUTION_SERVICE"].snapshot()
    blockers = [
        "ui_acceptance_pending",
        "real_data_provider_acceptance_pending",
        "production_research_protocol_pending",
        "path_dependent_analytics_data_pending",
        "real_broker_demo_acceptance_pending",
        "live_execution_permission_pending",
        "miro_update_pending",
        "final_owner_signoff_pending",
    ]
    if not ai["provider_health"]["available"]:
        blockers.append("real_ai_provider_acceptance_pending")
    return {
        "status_schema_version": "workspace-integration-status-v2",
        "entrypoint": app.config["WORKSPACE_ENTRYPOINT"],
        "database_user_versions": _database_versions(app.config["WORKSPACE_DATA_ROOT"]),
        "capabilities": {
            "chart_state": True,
            "research_engine": True,
            "research_reconciliation": True,
            "risk_lab": True,
            "prop_profile_evaluator": True,
            "learn_bridge": {
                "read_only": True,
                "progress_owner": "education/progress.json",
                "answer_keys_exposed": False,
            },
            "ai_advisory": ai,
            "execution": {
                "adapter": execution.get("adapter"),
                "connection": execution.get("connection"),
                "live_execution_enabled": execution.get("live_execution_enabled", False),
                "capabilities": execution.get("capabilities", {}),
                "kill_switch": execution.get("kill_switch"),
                "alert_runtime": execution.get("alert_runtime"),
            },
        },
        "acceptance": {
            "full_product_complete": False,
            "blockers": sorted(blockers),
        },
    }


def register_workspace_status_route(app):
    @app.get("/api/workspace/status")
    def workspace_status():
        return jsonify({"success": True, "workspace": build_workspace_status(app)})
