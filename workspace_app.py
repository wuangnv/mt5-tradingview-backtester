"""Supported daily workspace entrypoint layered on the P1-P5 factories."""

import os
from pathlib import Path

from p5_app import create_app as create_p5_app
from workspace_analytics import register_analytics_routes
from workspace_risk import register_risk_lab_routes


def workspace_paths(data_root=None):
    root = Path(data_root) if data_root else Path(__file__).resolve().parent / "data"
    return {
        "data_root": root,
        "evidence_db": Path(os.environ.get("EVIDENCE_DB_PATH") or root / "sessions.sqlite3"),
        "research_db": Path(os.environ.get("RESEARCH_DB_PATH") or root / "research.sqlite3"),
        "journal_db": Path(os.environ.get("JOURNAL_DB_PATH") or root / "journal.sqlite3"),
        "history_root": Path(os.environ.get("HISTORY_CHUNKS_PATH") or root / "chunks"),
        "execution_db": Path(os.environ.get("EXECUTION_DB_PATH") or root / "execution.sqlite3"),
    }


def create_app(data_root=None, **kwargs):
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
    register_analytics_routes(app)
    register_risk_lab_routes(app)
    return app


def main():
    data_root = os.environ.get("WORKSPACE_DATA_ROOT")
    app = create_app(data_root)
    port = int(os.environ.get("WORKSPACE_PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
