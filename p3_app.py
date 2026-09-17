"""P3 practice replay and journal shell layered on P1/P2."""

import os

from flask import jsonify, render_template, request

from journal_store import (
    JournalConflict,
    JournalError,
    JournalNotFound,
    JournalStore,
    JournalValidationError,
)
from p2_app import create_app as create_research_app
from practice_history import (
    PracticeHistoryError,
    PracticeHistoryInvalid,
    PracticeHistoryNotFound,
    ReadOnlyHistoryReader,
)
from practice_service import PracticeError, PracticeMappingError, PracticeService, PracticeValidationError


def create_app(
    evidence_db_path=None,
    research_db_path=None,
    journal_db_path=None,
    history_root=None,
    *,
    evidence_store=None,
    research_store=None,
    journal_store=None,
    history_reader=None,
):
    app = create_research_app(
        evidence_db_path,
        research_db_path,
        evidence_store=evidence_store,
        research_store=research_store,
    )
    app.config["JOURNAL_STORE"] = journal_store or JournalStore(journal_db_path)
    app.config["PRACTICE_HISTORY"] = history_reader or ReadOnlyHistoryReader(history_root)
    app.config["PRACTICE_SERVICE"] = PracticeService(
        app.config["EVIDENCE_STORE"],
        app.config["PRACTICE_HISTORY"],
        app.config["JOURNAL_STORE"],
    )

    def error_response(code, message, status):
        return jsonify({"success": False, "error": {"code": code, "message": message}}), status

    @app.errorhandler(JournalNotFound)
    def handle_journal_not_found(error):
        return error_response(error.code, str(error), 404)

    @app.errorhandler(JournalValidationError)
    def handle_journal_invalid(error):
        return error_response(error.code, str(error), 422)

    @app.errorhandler(JournalConflict)
    def handle_journal_conflict(error):
        return error_response(error.code, str(error), 409)

    @app.errorhandler(JournalError)
    def handle_journal_error(error):
        return error_response(error.code, str(error), 500)

    @app.errorhandler(PracticeHistoryNotFound)
    def handle_history_not_found(error):
        return error_response(error.code, str(error), 404)

    @app.errorhandler(PracticeHistoryInvalid)
    def handle_history_invalid(error):
        return error_response(error.code, str(error), 422)

    @app.errorhandler(PracticeHistoryError)
    def handle_history_error(error):
        return error_response(error.code, str(error), 500)

    @app.errorhandler(PracticeValidationError)
    def handle_practice_invalid(error):
        return error_response(error.code, str(error), 422)

    @app.errorhandler(PracticeMappingError)
    def handle_practice_mapping(error):
        return error_response(error.code, str(error), 409)

    @app.errorhandler(PracticeError)
    def handle_practice_error(error):
        return error_response(error.code, str(error), 500)

    def payload():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise PracticeValidationError("request body must be a JSON object")
        return value

    @app.get("/practice")
    def practice_workspace():
        return render_template("practice.html")

    @app.get("/api/practice/runs/<run_id>/trades/<trade_id>/context")
    def practice_context(run_id, trade_id):
        cursor_ms = request.args.get("cursor_ms")
        before_bars = request.args.get("before_bars", 100)
        context = app.config["PRACTICE_SERVICE"].trade_context(
            run_id,
            trade_id,
            cursor_ms=cursor_ms,
            before_bars=before_bars,
        )
        return jsonify({"success": True, "context": context})

    @app.get("/api/practice/journal")
    def journal_list():
        entries = app.config["JOURNAL_STORE"].list_entries(request.args.get("limit", 100))
        return jsonify({"success": True, "entries": entries})

    @app.get("/api/practice/journal/<entry_id>")
    def journal_detail(entry_id):
        entry = app.config["JOURNAL_STORE"].get(entry_id)
        return jsonify({"success": True, "entry": entry})

    @app.get("/api/practice/journal/<entry_id>/history")
    def journal_history(entry_id):
        revisions = app.config["JOURNAL_STORE"].history(entry_id)
        return jsonify({"success": True, "entry_id": str(entry_id), "revisions": revisions})

    @app.post("/api/practice/runs/<run_id>/trades/<trade_id>/journal")
    def journal_create(run_id, trade_id):
        entry = app.config["PRACTICE_SERVICE"].create_journal(run_id, trade_id, payload())
        return jsonify({"success": True, "entry": entry}), 201

    @app.patch("/api/practice/journal/<entry_id>")
    def journal_update(entry_id):
        entry = app.config["JOURNAL_STORE"].update(entry_id, payload())
        return jsonify({"success": True, "entry": entry})

    return app


app = create_app(
    os.environ.get("EVIDENCE_DB_PATH"),
    os.environ.get("RESEARCH_DB_PATH"),
    os.environ.get("JOURNAL_DB_PATH"),
    os.environ.get("HISTORY_CHUNKS_PATH"),
)


if __name__ == "__main__":
    port = int(os.environ.get("PRACTICE_PORT", "5003"))
    app.run(host="127.0.0.1", port=port, debug=False)
