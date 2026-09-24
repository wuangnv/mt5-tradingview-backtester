"""Read-only Learn bridge to the TradingWorkspace education source of truth."""

import json
from pathlib import Path

from flask import jsonify


class LearnCatalogError(RuntimeError):
    code = "LEARN_CATALOG_ERROR"


def _load_json(path, label):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LearnCatalogError(f"{label} is unavailable") from exc
    if not isinstance(value, dict):
        raise LearnCatalogError(f"{label} must be a JSON object")
    return value


def build_learn_overview(education_root):
    root = Path(education_root)
    course = _load_json(root / "course.json", "course manifest")
    progress = _load_json(root / "progress.json", "course progress")

    modules = []
    for module in course.get("modules") or []:
        if not isinstance(module, dict):
            continue
        modules.append(
            {
                "id": module.get("id"),
                "title": module.get("title"),
                "file": module.get("file"),
                "lessons": [
                    {"id": lesson.get("id"), "title": lesson.get("title")}
                    for lesson in module.get("lessons") or []
                    if isinstance(lesson, dict)
                ],
            }
        )

    main_course = progress.get("main_course")
    if not isinstance(main_course, dict):
        main_course = {}
    pending = progress.get("pending_activity")
    if not isinstance(pending, dict):
        pending = {}

    return {
        "schema_version": "learn-overview-v1",
        "course": {
            "version": course.get("version"),
            "title": course.get("title"),
            "status": course.get("status"),
            "primary_language": course.get("primary_language"),
            "start_lesson": course.get("start_lesson"),
            "modules": modules,
        },
        "progress": {
            "status": main_course.get("status"),
            "current_lesson_id": main_course.get("current_lesson_id"),
            "completed_lessons": list(main_course.get("completed_lessons") or []),
            "completed_modules": list(main_course.get("completed_modules") or []),
            "pending_activity": {
                key: pending.get(key)
                for key in ("id", "objective", "lesson_file", "variant")
                if pending.get(key) is not None
            },
        },
        "resources": [
            {"kind": "course", "path": "COURSE.md"},
            {"kind": "glossary", "path": "reference.md"},
            {"kind": "workbook", "path": "practice/workbook.md"},
        ],
        "safety": {
            "read_only": True,
            "progress_owner": "education/progress.json",
            "answer_keys_exposed": False,
            "auto_completion_enabled": False,
        },
    }


def register_learn_routes(app, education_root):
    root = Path(education_root)

    @app.errorhandler(LearnCatalogError)
    def handle_learn_catalog_error(error):
        return jsonify({"success": False, "error": {"code": error.code, "message": str(error)}}), 503

    @app.get("/api/learn/overview")
    def learn_overview():
        return jsonify({"success": True, "learn": build_learn_overview(root)})
