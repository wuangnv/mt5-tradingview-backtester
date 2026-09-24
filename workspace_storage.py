"""Copy-only backup and restore helpers for the integrated workspace."""

import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


BACKUP_SCHEMA_VERSION = 1
DATABASES = {
    "sessions.sqlite3": {0},
    "research.sqlite3": {0, 1, 2, 3},
    "journal.sqlite3": {0},
    "execution.sqlite3": {0, 1, 2, 3},
    "chart.sqlite3": {1},
}


class WorkspaceStorageError(RuntimeError):
    pass


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sqlite_metadata(path, allowed_versions):
    path = Path(path)
    if not path.is_file():
        raise WorkspaceStorageError(f"database is missing: {path.name}")
    try:
        uri = f"file:{path.resolve().as_posix()}?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=5)
        try:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        finally:
            connection.close()
    except sqlite3.Error as exc:
        raise WorkspaceStorageError(f"database is unreadable: {path.name}") from exc
    if integrity != "ok":
        raise WorkspaceStorageError(f"database integrity check failed: {path.name}")
    if version not in allowed_versions:
        raise WorkspaceStorageError(
            f"database schema is unsupported: {path.name} user_version={version}"
        )
    return {"user_version": version, "sha256": _sha256(path)}


def _sqlite_backup(source, destination):
    source = Path(source)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_uri = f"file:{source.resolve().as_posix()}?mode=ro"
    try:
        source_connection = sqlite3.connect(source_uri, uri=True, timeout=5)
        destination_connection = sqlite3.connect(str(destination), timeout=5)
        try:
            source_connection.backup(destination_connection)
        finally:
            destination_connection.close()
            source_connection.close()
    except sqlite3.Error as exc:
        raise WorkspaceStorageError(f"could not back up database: {source.name}") from exc


def _tree_manifest(root):
    root = Path(root)
    if not root.is_dir():
        return []
    return [
        {"path": path.relative_to(root).as_posix(), "sha256": _sha256(path)}
        for path in sorted(item for item in root.rglob("*") if item.is_file())
    ]


def _require_empty_directory(path, label):
    path = Path(path)
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise WorkspaceStorageError(f"{label} must be an empty directory: {path}")
    path.mkdir(parents=True, exist_ok=True)


def backup_workspace(source_root, backup_root):
    source_root = Path(source_root)
    backup_root = Path(backup_root)
    if not source_root.is_dir():
        raise WorkspaceStorageError(f"workspace data directory is missing: {source_root}")
    _require_empty_directory(backup_root, "backup destination")

    manifest = {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "databases": {},
        "history": [],
    }

    for name, allowed_versions in DATABASES.items():
        source = source_root / name
        if not source.exists():
            if name == "sessions.sqlite3":
                raise WorkspaceStorageError("evidence database is missing: sessions.sqlite3")
            continue
        source_meta = _sqlite_metadata(source, allowed_versions)
        destination = backup_root / name
        _sqlite_backup(source, destination)
        backup_meta = _sqlite_metadata(destination, allowed_versions)
        if source_meta["user_version"] != backup_meta["user_version"]:
            raise WorkspaceStorageError(f"database version changed during backup: {name}")
        manifest["databases"][name] = backup_meta

    history_source = source_root / "chunks"
    if history_source.is_dir():
        shutil.copytree(history_source, backup_root / "chunks")
        manifest["history"] = _tree_manifest(backup_root / "chunks")

    manifest_path = backup_root / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return manifest


def _load_manifest(backup_root):
    manifest_path = Path(backup_root) / "manifest.json"
    if not manifest_path.is_file():
        raise WorkspaceStorageError("backup manifest is missing")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkspaceStorageError("backup manifest is invalid") from exc
    if manifest.get("schema_version") != BACKUP_SCHEMA_VERSION:
        raise WorkspaceStorageError(
            f"backup schema is unsupported: {manifest.get('schema_version')!r}"
        )
    if not isinstance(manifest.get("databases"), dict) or not isinstance(manifest.get("history"), list):
        raise WorkspaceStorageError("backup manifest structure is invalid")
    return manifest


def _validate_backup(backup_root, manifest):
    backup_root = Path(backup_root)
    for name, metadata in manifest["databases"].items():
        allowed_versions = DATABASES.get(name)
        if allowed_versions is None:
            raise WorkspaceStorageError(f"backup contains an unsupported database: {name}")
        actual = _sqlite_metadata(backup_root / name, allowed_versions)
        if actual["sha256"] != metadata.get("sha256"):
            raise WorkspaceStorageError(f"backup database checksum mismatch: {name}")
        if actual["user_version"] != metadata.get("user_version"):
            raise WorkspaceStorageError(f"backup database version mismatch: {name}")

    for item in manifest["history"]:
        relative = item.get("path") if isinstance(item, dict) else None
        expected = item.get("sha256") if isinstance(item, dict) else None
        if not relative or not expected:
            raise WorkspaceStorageError("backup history manifest is invalid")
        path = backup_root / "chunks" / relative
        if not path.is_file() or _sha256(path) != expected:
            raise WorkspaceStorageError(f"backup history checksum mismatch: {relative}")


def restore_workspace(backup_root, target_root):
    backup_root = Path(backup_root)
    target_root = Path(target_root)
    if not backup_root.is_dir():
        raise WorkspaceStorageError(f"backup directory is missing: {backup_root}")
    manifest = _load_manifest(backup_root)
    _validate_backup(backup_root, manifest)
    _require_empty_directory(target_root, "restore destination")

    for name in manifest["databases"]:
        shutil.copy2(backup_root / name, target_root / name)
    if manifest["history"]:
        shutil.copytree(backup_root / "chunks", target_root / "chunks")

    for name, metadata in manifest["databases"].items():
        actual = _sqlite_metadata(target_root / name, DATABASES[name])
        if actual != metadata:
            raise WorkspaceStorageError(f"restored database verification failed: {name}")
    if _tree_manifest(target_root / "chunks") != manifest["history"]:
        raise WorkspaceStorageError("restored history verification failed")
    return manifest
