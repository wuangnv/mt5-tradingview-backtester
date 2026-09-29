"""Read-only packaging and clean-setup readiness audit.

The audit deliberately does not delete, move, install, start, or connect to
anything.  It produces a deterministic JSON-shaped report that can be stored
as U9/C0-C2 evidence after a clean checkout is prepared.  A dirty developer
checkout is reported as such; it is not mutated and does not make the default
audit fail.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = "package-readiness-v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _git(root: Path, *args: str) -> str | None:
    """Run a read-only git query, returning ``None`` outside a checkout."""

    try:
        completed = subprocess.run(
            ["git", "-C", str(root), *args],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return completed.stdout.strip()


def _file_check(root: Path, relative: str, *, required: bool = True) -> dict[str, Any]:
    path = root / relative
    exists = path.is_file()
    item: dict[str, Any] = {
        "path": relative,
        "required": required,
        "exists": exists,
    }
    if exists:
        item["sha256"] = _sha256(path)
        item["bytes"] = path.stat().st_size
    return item


def _tracked_files(root: Path) -> list[str]:
    listing = _git(root, "ls-files")
    if listing is None:
        return []
    return sorted(line for line in listing.splitlines() if line)


def _local_private_candidates(root: Path, tracked: list[str]) -> list[str]:
    """Find package-sensitive files without walking virtualenv/cache trees."""

    candidates = set(
        path
        for path in tracked
        if path.lower().endswith((".ini", ".bak", ".ex4", ".ex5"))
    )
    # Ignored MT5 binaries/configs are intentionally checked at the project
    # root.  We do not recurse through data or dependency environments.
    for path in root.iterdir():
        if path.is_file() and path.suffix.lower() in {".ini", ".bak", ".ex4", ".ex5"}:
            candidates.add(_relative(path, root))
    return sorted(candidates)


def inspect_project(project_root: Path = PROJECT_ROOT) -> dict[str, Any]:
    """Return a stable, read-only readiness report for ``project_root``."""

    root = Path(project_root).resolve()
    tracked = _tracked_files(root)
    status = _git(root, "status", "--porcelain")
    status_lines = sorted(status.splitlines()) if status else []

    manifests = [
        _file_check(root, "requirements.txt"),
        _file_check(root, "foundation_v2/pyproject.toml"),
        _file_check(root, "foundation_v2/uv.lock"),
        _file_check(root, "foundation_v2/web/package.json"),
        _file_check(root, "foundation_v2/web/package-lock.json"),
    ]
    entrypoints = [
        _file_check(root, "workspace_app.py"),
        _file_check(root, "Start-Windows.bat"),
        _file_check(root, "scripts/windows_start.ps1"),
        _file_check(root, "scripts/portability_smoke.py"),
        _file_check(root, "scripts/workspace_backup.py"),
    ]

    generated_markers = (
        ".venv/",
        ".pytest_cache/",
        "__pycache__/",
        "foundation_v2/web/node_modules/",
    )
    tracked_generated = [
        path for path in tracked if any(path.startswith(marker) for marker in generated_markers)
    ]
    private_candidates = _local_private_candidates(root, tracked)
    data_candidates = [
        relative
        for relative in ("data/", "runtime/", "foundation_v2/runtime/")
        if (root / relative.rstrip("/")).is_dir()
    ]

    required_files = manifests + entrypoints
    missing_required = [item["path"] for item in required_files if not item["exists"]]
    checks = {
        "supported_entrypoint": (root / "workspace_app.py").is_file(),
        "dependency_manifests": not any(not item["exists"] for item in manifests),
        "portable_smoke_declared": (root / "scripts/portability_smoke.py").is_file(),
        "backup_restore_declared": (root / "scripts/workspace_backup.py").is_file(),
        "generated_files_untracked": not tracked_generated,
        "clean_checkout": not status_lines,
    }

    return {
        "schema_version": SCHEMA_VERSION,
        "project": root.name,
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "git": {
            "head": _git(root, "rev-parse", "HEAD"),
            "branch": _git(root, "branch", "--show-current"),
            "dirty": bool(status_lines),
            "status": status_lines,
        },
        "manifests": manifests,
        "entrypoints": entrypoints,
        "tracked_inventory": {
            "file_count": len(tracked),
            "generated_candidates": tracked_generated,
        },
        "local_inventory": {
            "private_or_binary_candidates": private_candidates,
            "data_or_runtime_candidates": data_candidates,
        },
        "checks": checks,
        "missing_required": missing_required,
        "scope": {
            "execution_enabled": False,
            "broker_contacted": False,
            "holdout_read": False,
            "external_provider_contacted": False,
            "mutated_checkout": False,
        },
        "notes": [
            "This is a read-only inventory; a clean checkout must be audited separately.",
            "Private, binary, data, and runtime candidates require owner/license review before packaging.",
            "The audit does not claim the full product or broker/live gates are complete.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=str(PROJECT_ROOT))
    parser.add_argument(
        "--require-clean",
        action="store_true",
        help="return exit code 1 when the audited checkout has uncommitted changes",
    )
    args = parser.parse_args(argv)
    report = inspect_project(Path(args.project_root))
    print(json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True))
    if report["missing_required"]:
        return 1
    if args.require_clean and report["git"]["dirty"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
