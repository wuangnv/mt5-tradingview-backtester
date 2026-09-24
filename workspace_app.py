"""Supported daily workspace entrypoint layered on the P1-P5 factories."""

import os
from pathlib import Path

from ai_provider import OfflineProvider
from ai_service import AIService
from chart_store import ChartStore
from p5_app import create_app as create_p5_app
from research_engine import ResearchEngineRunner
from workspace_analytics import register_analytics_routes
from workspace_ai import register_ai_routes
from workspace_chart import register_chart_routes
from workspace_data import DataProviderRegistry, LocalChunksProvider, register_data_routes
from workspace_learn import register_learn_routes
from workspace_research_engine import register_research_engine_routes
from workspace_risk import register_risk_lab_routes
from workspace_status import register_workspace_status_route


def workspace_paths(data_root=None):
    root = Path(data_root) if data_root else Path(__file__).resolve().parent / "data"
    return {
        "data_root": root,
        "evidence_db": Path(os.environ.get("EVIDENCE_DB_PATH") or root / "sessions.sqlite3"),
        "research_db": Path(os.environ.get("RESEARCH_DB_PATH") or root / "research.sqlite3"),
        "journal_db": Path(os.environ.get("JOURNAL_DB_PATH") or root / "journal.sqlite3"),
        "history_root": Path(os.environ.get("HISTORY_CHUNKS_PATH") or root / "chunks"),
        "execution_db": Path(os.environ.get("EXECUTION_DB_PATH") or root / "execution.sqlite3"),
        "chart_db": Path(os.environ.get("CHART_DB_PATH") or root / "chart.sqlite3"),
    }


def create_app(data_root=None, **kwargs):
    ai_provider = kwargs.pop("ai_provider", None)
    ai_enabled_jobs = kwargs.pop("ai_enabled_jobs", None)
    education_root = kwargs.pop("education_root", None)
    paths = workspace_paths(data_root)
    app = create_p5_app(
        paths["evidence_db"],
        paths["research_db"],
        paths["journal_db"],
        paths["history_root"],
        paths["execution_db"],
        **kwargs,
    )
    app.config["WORKSPACE_DATA_ROOT"] = str(paths["data_root"])
    app.config["WORKSPACE_ENTRYPOINT"] = "workspace_app.py"
    data_registry = DataProviderRegistry([LocalChunksProvider(paths["history_root"])])
    app.config["DATA_PROVIDER_REGISTRY"] = data_registry
    register_data_routes(app, data_registry)
    register_chart_routes(app, ChartStore(paths["chart_db"]))
    register_research_engine_routes(
        app, ResearchEngineRunner(app.config["RESEARCH_STORE"], paths["data_root"])
    )
    if ai_enabled_jobs is None:
        enabled_jobs = {
            job
            for job, env_name in (
                ("playbook_search", "AI_PLAYBOOK_SEARCH"),
                ("research_rule_draft", "AI_RESEARCH_DRAFT"),
                ("journal_review", "AI_JOURNAL_REVIEW"),
                ("chart_overlay", "AI_CHART_OVERLAY"),
            )
            if str(os.environ.get(env_name) or "0").strip() == "1"
        }
    else:
        enabled_jobs = set(ai_enabled_jobs)
    register_ai_routes(
        app,
        AIService(
            ai_provider or OfflineProvider(),
            enabled_jobs=enabled_jobs,
            max_payload_bytes=int(os.environ.get("AI_MAX_PAYLOAD_BYTES", "16384")),
            max_input_items=int(os.environ.get("AI_MAX_INPUT_ITEMS", "64")),
        ),
    )
    register_analytics_routes(app)
    register_risk_lab_routes(app)
    if education_root is None:
        education_root = os.environ.get("EDUCATION_ROOT") or Path(__file__).resolve().parents[2] / "education"
    register_learn_routes(app, education_root)
    register_workspace_status_route(app)
    return app


def main():
    data_root = os.environ.get("WORKSPACE_DATA_ROOT")
    app = create_app(data_root)
    port = int(os.environ.get("WORKSPACE_PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
