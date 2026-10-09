from __future__ import annotations

import hashlib
import json
import os
import stat
from collections.abc import Iterable
from pathlib import Path
from uuid import uuid4

import pyarrow as pa
import pyarrow.parquet as pq


class ArtifactConflict(RuntimeError):
    pass


def _safe_component(value: str, label: str) -> str:
    """Validate an identifier before using it as one filesystem path component.

    Artifact identifiers originate at API/store boundaries.  Keeping them as a
    single component prevents traversal, alternate data streams, and Windows
    name-normalisation collisions while preserving the identifier itself.
    """

    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty path component")
    if value in {".", ".."} or any(character in value for character in ("/", "\\", ":")):
        raise ValueError(f"{label} must be a single path component")
    if any(ord(character) < 32 for character in value) or value[-1] in {".", " "}:
        raise ValueError(f"{label} must be a single path component")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)), *(f"LPT{n}" for n in range(1, 10))}
    if value.split(".")[0].upper() in reserved:
        raise ValueError(f"{label} uses a reserved path component")
    return value


def sha256_file(path: Path, continue_check=None) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            if continue_check is not None:
                continue_check()
            digest.update(block)
    return digest.hexdigest()


def canonical_json_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _sync_directory(directory: Path) -> None:
    if os.name != "nt":
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def publish_immutable(temp: Path, target: Path, *, sync_file: bool = True) -> None:
    """Publish without replacing a concurrent winner; persist bytes before the name."""
    if sync_file:
        with temp.open("r+b") as handle:
            os.fsync(handle.fileno())
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        move = kernel.MoveFileExW
        move.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD)
        move.restype = wintypes.BOOL
        # MOVEFILE_WRITE_THROUGH, deliberately without REPLACE_EXISTING.
        if not move(str(temp), str(target), 0x8):
            error = ctypes.get_last_error()
            if error in (80, 183):
                raise ArtifactConflict(f"artifact already exists: {target.name}")
            raise ctypes.WinError(error)
    else:
        try:
            os.link(temp, target)
        except FileExistsError as exc:
            raise ArtifactConflict(f"artifact already exists: {target.name}") from exc
        _sync_directory(target.parent)
        temp.unlink()
        _sync_directory(target.parent)


def _file_identity(value: os.stat_result) -> tuple:
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


class ArtifactStore:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        _sync_directory(self.root.parent)

    def _mkdir(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        for directory in (path, *path.parents):
            _sync_directory(directory)
            if directory == self.root:
                break

    def _path(self, relative_path: str | Path) -> Path:
        relative = Path(relative_path)
        if relative.is_absolute() or not relative.parts or any(part in {".", ".."} for part in relative.parts):
            raise ValueError("artifact path escapes root")
        for part in relative.parts:
            _safe_component(part, "artifact path")
        path = self.root / relative
        for component in (path, *path.parents):
            if component == self.root:
                break
            if component.is_symlink() or getattr(component, "is_junction", lambda: False)():
                raise ValueError("artifact path escapes root")
        if self.root not in path.resolve().parents:
            raise ValueError("artifact path escapes root")
        return path

    def _workspace_dir(self, workspace_id: str, family: str) -> Path:
        safe = _safe_component(workspace_id, "workspace_id")
        safe_family = _safe_component(family, "artifact family")
        path = self._path(Path(safe) / safe_family)
        self._mkdir(path)
        return path

    def write_dataset(self, workspace_id: str, dataset_id: str, rows: list[dict]) -> tuple[str, str]:
        return self.write_dataset_iter(workspace_id, dataset_id, rows)

    def write_dataset_iter(
        self,
        workspace_id: str,
        dataset_id: str,
        rows: Iterable[dict],
        *,
        batch_size: int = 50_000,
        continue_check=None,
    ) -> tuple[str, str]:
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        safe_dataset = _safe_component(dataset_id, "dataset_id")
        target = self._workspace_dir(workspace_id, "datasets") / f"{safe_dataset}.parquet"
        if target.exists():
            raise ArtifactConflict(f"dataset artifact already exists: {dataset_id}")
        temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        writer = None
        batch = []
        try:
            for row in rows:
                batch.append(row)
                if len(batch) >= batch_size:
                    if continue_check is not None:
                        continue_check()
                    table = pa.Table.from_pylist(batch)
                    if writer is None:
                        writer = pq.ParquetWriter(temp, table.schema, compression="zstd")
                    elif table.schema != writer.schema:
                        table = table.cast(writer.schema)
                    writer.write_table(table)
                    batch.clear()
            if batch:
                if continue_check is not None:
                    continue_check()
                table = pa.Table.from_pylist(batch)
                if writer is None:
                    writer = pq.ParquetWriter(temp, table.schema, compression="zstd")
                elif table.schema != writer.schema:
                    table = table.cast(writer.schema)
                writer.write_table(table)
            if writer is None:
                raise ValueError("dataset requires at least one row")
            writer.close()
            writer = None
            digest = sha256_file(temp, continue_check)
            if continue_check is not None:
                continue_check()
            publish_immutable(temp, target)
        finally:
            if writer is not None:
                writer.close()
            if temp.exists():
                temp.unlink()
        return str(target.relative_to(self.root)), digest

    def write_raw_source(self, workspace_id: str, dataset_id: str, source_path: str | Path, *, continue_check=None) -> tuple[str, str]:
        source = Path(source_path)
        if not source.is_file():
            raise FileNotFoundError(source)
        safe_dataset = _safe_component(dataset_id, "dataset_id")
        target_dir = self._path(self._workspace_dir(workspace_id, "raw").relative_to(self.root) / safe_dataset)
        target = target_dir / "source.csv"
        if target.exists():
            raise ArtifactConflict(f"raw artifact already exists: {dataset_id}")
        self._mkdir(target_dir)
        temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        try:
            with source.open("rb") as source_handle, temp.open("wb") as target_handle:
                for block in iter(lambda: source_handle.read(1024 * 1024), b""):
                    if continue_check is not None:
                        continue_check()
                    target_handle.write(block)
                target_handle.flush()
                os.fsync(target_handle.fileno())
            digest = sha256_file(temp, continue_check)
            if continue_check is not None:
                continue_check()
            publish_immutable(temp, target)
        finally:
            if temp.exists():
                temp.unlink()
        return str(target.relative_to(self.root)), digest

    def dataset_paths(self, workspace_id, dataset_id, artifact_path, raw_artifact_path=None):
        workspace = _safe_component(workspace_id, 'workspace_id')
        dataset = _safe_component(dataset_id, 'dataset_id')
        paths = [Path(workspace) / 'datasets' / f'{dataset}.parquet']
        declared = [artifact_path]
        if raw_artifact_path is not None:
            paths.append(Path(workspace) / 'raw' / dataset / 'source.csv')
            declared.append(raw_artifact_path)
        for relative, value in zip(paths, declared):
            if not isinstance(value, str) or Path(value) != relative:
                raise ValueError('invalid_dataset_artifact_path')
            path = self.root / relative
            for component in (path, *path.parents):
                if component == self.root:
                    break
                if component.is_symlink() or getattr(component, 'is_junction', lambda: False)():
                    raise ValueError('invalid_dataset_artifact_path')
            if self.root not in path.resolve().parents:
                raise ValueError('invalid_dataset_artifact_path')
            if path.exists() and not path.is_file():
                raise ValueError('invalid_dataset_artifact_path')
        return [self.root / relative for relative in paths]

    def dataset_size_bytes(self, manifest):
        try:
            paths = self.dataset_paths(manifest.workspace_id, manifest.dataset_id, manifest.artifact_path, manifest.raw_artifact_path)
            return paths[0].stat().st_size
        except (OSError, ValueError):
            return None

    def read_dataset(self, relative_path: str, expected_sha256: str) -> list[dict]:
        path = self._path(relative_path)
        with path.open("rb") as handle:
            identity = self._verify_dataset(handle, expected_sha256)
            rows = pq.ParquetFile(handle).read().to_pylist()
            self._verify_unchanged(path, handle, identity)
            return rows

    @staticmethod
    def _verify_dataset(handle, expected_sha256, continue_check=None):
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("artifact must be a regular file")
        digest = hashlib.sha256()
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            if continue_check is not None:
                continue_check()
            digest.update(block)
        identity = _file_identity(before)
        if digest.hexdigest() != expected_sha256 or _file_identity(os.fstat(handle.fileno())) != identity:
            raise ArtifactConflict("dataset checksum mismatch")
        handle.seek(0)
        return identity

    def _verify_unchanged(self, path, handle, identity):
        # Windows 3.12 path.stat and fstat expose different ctime semantics.
        # Compare ctime only descriptor-to-descriptor, and retain inode/size/mtime
        # on the pathname check to detect replacement while this handle is open.
        if self._path(path.relative_to(self.root)) != path or _file_identity(os.fstat(handle.fileno())) != identity or _file_identity(path.stat())[:4] != identity[:4]:
            raise ArtifactConflict("dataset changed during read")

    def read_dataset_range(
        self, relative_path: str, expected_sha256: str, *, from_utc: int, to_utc: int,
        max_bars: int, continue_check=None,
    ) -> list[dict]:
        if max_bars < 0 or to_utc < from_utc:
            raise ValueError("invalid dataset range budget")
        path = self._path(relative_path)
        rows = []
        with path.open("rb") as handle:
            identity = self._verify_dataset(handle, expected_sha256, continue_check)
            parquet = pq.ParquetFile(handle)
            timestamp_column = parquet.schema_arrow.get_field_index("timestamp")
            if timestamp_column < 0:
                raise ValueError("dataset has no timestamp column")
            groups = []
            for index in range(parquet.num_row_groups):
                statistics = parquet.metadata.row_group(index).column(timestamp_column).statistics
                if statistics is None or not statistics.has_min_max or (statistics.min < to_utc and statistics.max >= from_utc):
                    groups.append(index)
            for batch in parquet.iter_batches(batch_size=4096, row_groups=groups, columns=["timestamp", "open", "high", "low", "close"]):
                if continue_check is not None:
                    continue_check()
                for row in batch.to_pylist():
                    if from_utc <= row["timestamp"] < to_utc:
                        if len(rows) >= max_bars:
                            raise ValueError("run exceeded budget.max_bars")
                        rows.append(row)
            self._verify_unchanged(path, handle, identity)
        return rows

    def write_result(self, workspace_id: str, job_id: str, payload: dict) -> tuple[str, str]:
        safe_job = _safe_component(job_id, "job_id")
        results = self._workspace_dir(workspace_id, "results")
        target = results / f"{safe_job}.json"
        if target.exists() or (results / safe_job).exists():
            raise ArtifactConflict(f"result artifact already exists: {safe_job}")
        data = canonical_json_bytes(payload)
        temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        try:
            temp.write_bytes(data)
            publish_immutable(temp, target)
        finally:
            temp.unlink(missing_ok=True)
        return str(target.relative_to(self.root)), hashlib.sha256(data).hexdigest()

    def write_result_candidate(
        self,
        workspace_id: str,
        job_id: str,
        attempt_no: int,
        lease_token: str,
        payload: dict,
    ) -> tuple[str, str]:
        safe_job = _safe_component(job_id, "job_id")
        results = self._workspace_dir(workspace_id, "results")
        legacy_target = results / f"{safe_job}.json"
        if legacy_target.exists():
            raise ArtifactConflict(f"result artifact already exists: {safe_job}")
        attempt_dir = self._path(results.relative_to(self.root) / safe_job)
        self._mkdir(attempt_dir)
        token_key = hashlib.sha256(lease_token.encode("utf-8")).hexdigest()[:16]
        target = attempt_dir / f"attempt-{attempt_no:06d}-{token_key}.json"
        if target.exists():
            raise ArtifactConflict(f"result candidate already exists: {job_id} attempt {attempt_no}")
        data = canonical_json_bytes(payload)
        temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        try:
            temp.write_bytes(data)
            publish_immutable(temp, target)
        finally:
            temp.unlink(missing_ok=True)
        return str(target.relative_to(self.root)), hashlib.sha256(data).hexdigest()

    def quarantine_result_candidate(self, relative_path: str) -> str | None:
        source = self._path(relative_path)
        try:
            relative = source.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("artifact path escapes root") from exc
        parts = relative.parts
        if len(parts) < 4 or parts[1] != "results" or not source.name.startswith("attempt-"):
            raise ValueError("not a result candidate path")
        workspace_id, _, job_id = parts[:3]
        safe_workspace = _safe_component(workspace_id, "workspace_id")
        safe_job = _safe_component(job_id, "job_id")
        quarantine_dir = self._path(Path(safe_workspace) / "quarantine" / "results" / safe_job)
        self._mkdir(quarantine_dir)
        target = quarantine_dir / source.name
        if not source.exists():
            return str(target.relative_to(self.root)) if target.exists() else None
        if target.exists():
            if not source.exists():
                return str(target.relative_to(self.root))
            if os.path.samefile(source, target):
                source.unlink(missing_ok=True)
                _sync_directory(source.parent)
                return str(target.relative_to(self.root))
            raise ArtifactConflict(f"quarantine artifact already exists: {relative_path}")
        try:
            # Candidates were synced when created. Reopening them writable here
            # can block a concurrent Windows rename, so sync only the new name.
            publish_immutable(source, target, sync_file=False)
        except ArtifactConflict:
            if not source.exists() and target.exists():
                return str(target.relative_to(self.root))
            if source.exists() and target.exists() and os.path.samefile(source, target):
                source.unlink(missing_ok=True)
                _sync_directory(source.parent)
                return str(target.relative_to(self.root))
            raise
        except FileNotFoundError:
            if target.exists():
                return str(target.relative_to(self.root))
            return None
        try:
            source.parent.rmdir()
        except OSError:
            pass
        return str(target.relative_to(self.root))

    def quarantine_job_candidates(self, workspace_id: str, job_id: str) -> list[str]:
        safe_workspace = _safe_component(workspace_id, "workspace_id")
        safe_job = _safe_component(job_id, "job_id")
        attempt_dir = (self.root / safe_workspace / "results" / safe_job).resolve()
        if self.root not in attempt_dir.parents or not attempt_dir.exists():
            return []
        quarantined = []
        for candidate in sorted(attempt_dir.glob("attempt-*.json")):
            relative = str(candidate.relative_to(self.root))
            moved = self.quarantine_result_candidate(relative)
            if moved:
                quarantined.append(moved)
        return quarantined

    def read_json(self, relative_path: str, expected_sha256: str) -> dict:
        path = self._path(relative_path)
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_sha256:
            raise ArtifactConflict("result checksum mismatch")
        return json.loads(data)
