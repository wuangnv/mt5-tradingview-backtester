"""Checked DB-dump/artifact bundles; no live DB restore or cloud provisioning.

The caller must stop mutations/deletions while pg_dump and artifact references
are captured. Hashes prove bytes, not a consistent PostgreSQL/filesystem snapshot.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path
from uuid import uuid4

from .artifacts import ArtifactConflict, ArtifactStore, _sync_directory, canonical_json_bytes, publish_immutable, sha256_file

SCHEMA = "tw-artifact-backup-v1"


def _io_path(path: Path) -> Path:
    """Windows backup roots add nesting; keep logical manifest paths unchanged."""
    absolute = str(path.absolute())
    if os.name != "nt" or absolute.startswith("\\\\?\\"):
        return path
    return Path("\\\\?\\UNC\\" + absolute[2:] if absolute.startswith("\\\\") else "\\\\?\\" + absolute)


def _copy_checked(source: Path, destination: Path, checksum: str) -> None:
    source, destination = _io_path(source), _io_path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    for directory in (destination.parent, *destination.parent.parents):
        _sync_directory(directory)
    temp = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    try:
        with source.open("rb") as reader, temp.open("xb") as writer:
            shutil.copyfileobj(reader, writer, 1024 * 1024)
            writer.flush()
            os.fsync(writer.fileno())
        if sha256_file(temp) != checksum:
            raise ArtifactConflict("backup source checksum mismatch")
        publish_immutable(temp, destination)
    finally:
        temp.unlink(missing_ok=True)


def create_backup_bundle(
    artifact_root: Path, metadata_dump: Path, destination: Path, *,
    artifact_references: dict[str, str], snapshot_id: str, mutations_quiesced: bool,
) -> dict:
    if not mutations_quiesced or not snapshot_id:
        raise ValueError("backup requires a quiesced metadata/artifact snapshot")
    # A failed bundle remains visibly incomplete; never overwrite or resume it
    # implicitly against a different database snapshot.
    destination.mkdir(parents=True, exist_ok=False)
    store = ArtifactStore(artifact_root)
    dump_hash = sha256_file(metadata_dump)
    _copy_checked(metadata_dump, destination / "metadata.dump", dump_hash)
    entries = [{"path": "metadata.dump", "sha256": dump_hash, "size_bytes": _io_path(destination / "metadata.dump").stat().st_size}]
    for relative, checksum in sorted(artifact_references.items()):
        source = store._path(relative)
        key = "artifacts/" + source.relative_to(store.root).as_posix()
        _copy_checked(source, destination / key, checksum)
        entries.append({"path": key, "sha256": checksum, "size_bytes": _io_path(destination / key).stat().st_size})
    manifest = {"schema": SCHEMA, "snapshot_id": snapshot_id, "consistency": "quiesced", "files": entries}
    ArtifactStore(_io_path(destination)).write_result("bundle", "manifest", manifest)
    return manifest


def verify_backup_bundle(bundle: Path, *, max_bytes: int = 1024 ** 4) -> dict:
    store = ArtifactStore(bundle)
    manifest_path = _io_path(store._path("bundle/results/manifest.json"))
    manifest = json.loads(manifest_path.read_bytes())
    validate_manifest(manifest, max_bytes=max_bytes)
    for entry in manifest["files"]:
        path = _io_path(store._path(entry["path"]))
        if path.stat().st_size != entry["size_bytes"] or sha256_file(path) != entry["sha256"]:
            raise ArtifactConflict("backup bundle checksum mismatch")
    return manifest


def validate_manifest(manifest: dict, *, max_bytes: int) -> None:
    if manifest.get("schema") != SCHEMA or manifest.get("consistency") != "quiesced" or not manifest.get("snapshot_id"):
        raise ValueError("unsupported backup manifest")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries or len(entries) > 100_000:
        raise ValueError("invalid backup file count")
    seen = set()
    total = 0
    for entry in entries:
        path = entry.get("path", "")
        if not isinstance(path, str) or "\\" in path or path.startswith("/") or any(part in {"", ".", ".."} for part in path.split("/")):
            raise ValueError("invalid backup file path")
        if path != "metadata.dump" and not path.startswith("artifacts/"):
            raise ValueError("invalid backup file path")
        checksum, size = entry.get("sha256"), entry.get("size_bytes")
        if not isinstance(checksum, str) or len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
            raise ValueError("invalid backup checksum")
        if type(size) is not int or size < 0 or path in seen:
            raise ValueError("invalid backup entry")
        seen.add(path)
        total += size
    if "metadata.dump" not in seen or total > max_bytes:
        raise ValueError("backup exceeds restore budget or has no metadata dump")


def restore_backup_files(bundle: Path, destination: Path, *, max_bytes: int = 1024 ** 4) -> Path:
    manifest = verify_backup_bundle(bundle, max_bytes=max_bytes)
    destination.mkdir(parents=True, exist_ok=False)
    source_store, target_store = ArtifactStore(bundle), ArtifactStore(destination)
    for entry in manifest["files"]:
        _copy_checked(source_store._path(entry["path"]), target_store._path(entry["path"]), entry["sha256"])
    # pg_restore is intentionally an explicit caller action after all hashes pass.
    return destination / "metadata.dump"


class S3BackupRepository:
    """Optional injected boto3-compatible client; publishes checked bundles last.

    Uses conditional puts, not a head-then-put race. Providers lacking IfNoneMatch
    are rejected rather than silently permitting overwrite. Single-put objects
    are bounded to 64 MiB by default; larger archives need separately verified
    multipart upload/cleanup support before promotion.
    """

    def __init__(self, client, bucket: str, *, prefix: str = "tw-backups", max_object_bytes: int = 64 * 1024 * 1024):
        if not bucket or not prefix or any(part in {"", ".", ".."} for part in prefix.split("/")) or "\\" in prefix:
            raise ValueError("invalid S3 backup configuration")
        if not 0 < max_object_bytes <= 64 * 1024 * 1024:
            raise ValueError("invalid object budget")
        self.client, self.bucket, self.prefix = client, bucket, prefix
        self.max_object_bytes = max_object_bytes

    def _put(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, IfNoneMatch="*",
                               Metadata={"sha256": hashlib.sha256(data).hexdigest()})

    def upload_bundle(self, bundle: Path) -> str:
        manifest = verify_backup_bundle(bundle)
        store = ArtifactStore(bundle)
        # Preflight before any upload; unsupported large bundles remain local.
        if any(entry["size_bytes"] > self.max_object_bytes for entry in manifest["files"]):
            raise ValueError("backup object exceeds single-put budget")
        identifier = uuid4().hex
        prefix = f"{self.prefix}/{identifier}"
        for entry in manifest["files"]:
            data = _io_path(store._path(entry["path"])).read_bytes()
            if len(data) != entry["size_bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise ArtifactConflict("backup changed during upload")
            self._put(f"{prefix}/{entry['path']}", data)
        data = canonical_json_bytes(manifest)
        self._put(f"{prefix}/manifest.json", data)
        return f"{identifier}:{hashlib.sha256(data).hexdigest()}"

    def _get(self, key: str, max_bytes: int) -> bytes:
        result = self.client.get_object(Bucket=self.bucket, Key=key)
        body = result["Body"]
        try:
            if result.get("ContentLength", 0) > max_bytes:
                raise ValueError("backup object exceeds download budget")
            data = body.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise ValueError("backup object exceeds download budget")
            return data
        finally:
            body.close()

    def download_bundle(self, reference: str, destination: Path, *, max_bytes: int = 1024 ** 4) -> dict:
        identifier, checksum = reference.split(":", 1)
        if len(identifier) != 32 or any(c not in "0123456789abcdef" for c in identifier):
            raise ValueError("invalid backup reference")
        prefix = f"{self.prefix}/{identifier}"
        data = self._get(f"{prefix}/manifest.json", 16 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise ArtifactConflict("remote backup manifest checksum mismatch")
        manifest = json.loads(data)
        validate_manifest(manifest, max_bytes=max_bytes)
        if any(entry["size_bytes"] > self.max_object_bytes for entry in manifest["files"]):
            raise ValueError("backup object exceeds single-put budget")
        destination.mkdir(parents=True, exist_ok=False)
        store = ArtifactStore(destination)
        for entry in manifest["files"]:
            content = self._get(f"{prefix}/{entry['path']}", entry["size_bytes"])
            if len(content) != entry["size_bytes"] or hashlib.sha256(content).hexdigest() != entry["sha256"]:
                raise ArtifactConflict("remote backup object checksum mismatch")
            target = _io_path(store._path(entry["path"]))
            target.parent.mkdir(parents=True, exist_ok=True)
            temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
            try:
                temp.write_bytes(content)
                publish_immutable(temp, target)
            finally:
                temp.unlink(missing_ok=True)
        store.write_result("bundle", "manifest", manifest)
        return verify_backup_bundle(destination, max_bytes=max_bytes)
