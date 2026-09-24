from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path, PurePosixPath


class LearnCatalogError(RuntimeError):
    pass


class LearnWorkspaceNotConfigured(LookupError):
    pass


class LearnResourceNotFound(LookupError):
    pass


class LearnCatalog:
    """Read-only bridge to the education source of truth, scoped per workspace."""

    def __init__(self, roots_by_workspace: Mapping[str, str | Path] | None = None):
        self._roots = {
            str(workspace_id).strip(): Path(root).resolve()
            for workspace_id, root in (roots_by_workspace or {}).items()
            if str(workspace_id).strip()
        }

    @property
    def configured_workspaces(self) -> tuple[str, ...]:
        return tuple(sorted(self._roots))

    def overview(self, workspace_id: str) -> dict:
        root = self._root_for(workspace_id)
        course = self._load_json(root / "course.json", "course manifest")
        progress = self._load_json(root / "progress.json", "course progress")

        modules = []
        lesson_count = 0
        for module in course.get("modules") or []:
            if not isinstance(module, dict):
                continue
            lessons = [
                {"id": lesson.get("id"), "title": lesson.get("title")}
                for lesson in module.get("lessons") or []
                if isinstance(lesson, dict)
            ]
            lesson_count += len(lessons)
            module_id = module.get("id")
            item = {
                "id": module_id,
                "title": module.get("title"),
                "lessons": lessons,
            }
            if module_id and self._safe_relative_path(module.get("file")) is not None:
                item["href"] = f"/api/v2/learn/resources/module:{module_id}"
            modules.append(item)

        main_course = progress.get("main_course")
        if not isinstance(main_course, dict):
            main_course = {}
        pending = progress.get("pending_activity")
        if not isinstance(pending, dict):
            pending = {}

        links = {
            "course": "/api/v2/learn/resources/course",
            "glossary": "/api/v2/learn/glossary",
            "workbook": "/api/v2/learn/resources/workbook",
        }
        if self._pending_resource_path(pending) is not None:
            links["pending_activity"] = "/api/v2/learn/resources/pending-activity"

        return {
            "schema_version": "learn-overview-v2",
            "course": {
                "version": course.get("version"),
                "title": course.get("title"),
                "status": course.get("status"),
                "primary_language": course.get("primary_language"),
                "start_lesson": course.get("start_lesson"),
                "module_count": len(modules),
                "lesson_count": lesson_count,
                "modules": modules,
            },
            "progress": {
                "phase": progress.get("phase"),
                "course_version": progress.get("course_version"),
                "updated_on": progress.get("updated_on"),
                "status": main_course.get("status"),
                "current_lesson_id": main_course.get("current_lesson_id"),
                "completed_lessons": list(main_course.get("completed_lessons") or []),
                "completed_modules": list(main_course.get("completed_modules") or []),
                "pending_status": progress.get("pending_status"),
                "pending_activity": {
                    key: pending.get(key)
                    for key in ("id", "objective", "lesson_file", "variant")
                    if pending.get(key) is not None
                },
            },
            "links": links,
            "safety": {
                "read_only": True,
                "progress_owner": "education/progress.json",
                "answer_keys_exposed": False,
                "auto_completion_enabled": False,
            },
        }

    def glossary(self, workspace_id: str) -> dict:
        root = self._root_for(workspace_id)
        text = self._read_text(root / "reference.md", "course reference")
        entries = self._parse_glossary(text)
        return {
            "schema_version": "learn-glossary-v1",
            "primary_language": "vi",
            "english_role": "trading_terminology_support_only",
            "items": entries,
            "count": len(entries),
        }

    def resource(self, workspace_id: str, resource_id: str) -> dict:
        root = self._root_for(workspace_id)
        relative = self._resource_path(root, resource_id)
        text = self._read_text(root / relative, "learn resource")
        return {
            "resource_id": resource_id,
            "format": "markdown",
            "content": text,
        }

    def _resource_path(self, root: Path, resource_id: str) -> PurePosixPath:
        if resource_id == "course":
            return PurePosixPath("COURSE.md")
        if resource_id == "workbook":
            return PurePosixPath("practice/workbook.md")
        if resource_id == "pending-activity":
            progress = self._load_json(root / "progress.json", "course progress")
            pending = progress.get("pending_activity")
            if not isinstance(pending, dict):
                raise LearnResourceNotFound("pending activity resource is unavailable")
            path = self._pending_resource_path(pending)
            if path is None:
                raise LearnResourceNotFound("pending activity resource is unavailable")
            return path
        if resource_id.startswith("module:"):
            course = self._load_json(root / "course.json", "course manifest")
            module_id = resource_id.removeprefix("module:")
            for module in course.get("modules") or []:
                if isinstance(module, dict) and module.get("id") == module_id:
                    path = self._safe_relative_path(module.get("file"))
                    if path is not None:
                        return path
                    break
        raise LearnResourceNotFound("learn resource is not available")

    def _root_for(self, workspace_id: str) -> Path:
        root = self._roots.get(str(workspace_id).strip())
        if root is None:
            raise LearnWorkspaceNotConfigured("learn is not configured for this workspace")
        return root

    @staticmethod
    def _load_json(path: Path, label: str) -> dict:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise LearnCatalogError(f"{label} is unavailable") from exc
        if not isinstance(value, dict):
            raise LearnCatalogError(f"{label} must be a JSON object")
        return value

    @staticmethod
    def _read_text(path: Path, label: str) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            raise LearnCatalogError(f"{label} is unavailable") from exc

    @staticmethod
    def _safe_relative_path(value) -> PurePosixPath | None:
        if not isinstance(value, str) or not value.strip():
            return None
        path = PurePosixPath(value.strip().replace("\\", "/"))
        if path.is_absolute() or ".." in path.parts or path.parts[0] == "assessments":
            return None
        return path

    def _pending_resource_path(self, pending: dict) -> PurePosixPath | None:
        path = self._safe_relative_path(pending.get("lesson_file"))
        if path is None or not path.parts or path.parts[0] != "practice":
            return None
        return path

    @staticmethod
    def _parse_glossary(text: str) -> list[dict]:
        entries = []
        in_glossary = False
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if line.startswith("## "):
                if in_glossary:
                    break
                in_glossary = "Thuật ngữ theo ngữ cảnh" in line
                continue
            if not in_glossary or not line.startswith("|"):
                continue
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) != 2 or cells[0] in {"Thuật ngữ", "---"} or set(cells[0]) == {"-"}:
                continue
            entries.append({"term": cells[0], "meaning_vi": cells[1]})
        return entries
