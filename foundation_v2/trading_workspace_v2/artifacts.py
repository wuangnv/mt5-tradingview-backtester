from __future__ import annotations

import hashlib
import json
import os
import shutil
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
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


class ArtifactStore:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _workspace_dir(self, workspace_id: str, family: str) -> Path:
        safe = _safe_component(workspace_id, "workspace_id")
        safe_family = _safe_component(family, "artifact family")
        path = self.root / safe / safe_family
        path.mkdir(parents=True, exist_ok=True)
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
                    table = pa.Table.from_pylist(batch)
                    if writer is None:
                        writer = pq.ParquetWriter(temp, table.schema, compression="zstd")
                    elif table.schema != writer.schema:
                        table = table.cast(writer.schema)
                    writer.write_table(table)
                    batch.clear()
            if batch:
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
            os.replace(temp, target)
        finally:
            if writer is not None:
                writer.close()
            if temp.exists():
                temp.unlink()
        return str(target.relative_to(self.root)), sha256_file(target)

    def write_raw_source(self, workspace_id: str, dataset_id: str, source_path: str | Path) -> tuple[str, str]:
        source = Path(source_path)
        if not source.is_file():
            raise FileNotFoundError(source)
        safe_dataset = _safe_component(dataset_id, "dataset_id")
        target_dir = self._workspace_dir(workspace_id, "raw") / safe_dataset
        target = target_dir / "source.csv"
        if target.exists():
            raise ArtifactConflict(f"raw artifact already exists: {dataset_id}")
        target_dir.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        try:
            with source.open("rb") as source_handle, temp.open("wb") as target_handle:
                shutil.copyfileobj(source_handle, target_handle, length=1024 * 1024)
                target_handle.flush()
                os.fsync(target_handle.fileno())
            os.replace(temp, target)
        finally:
            if temp.exists():
                temp.unlink()
        return str(target.relative_to(self.root)), sha256_file(target)

    def read_dataset(self, relative_path: str, expected_sha256: str) -> list[dict]:
        path = (self.root / relative_path).resolve()
        if self.root not in path.parents:
            raise ValueError("artifact path escapes root")
        if sha256_file(path) != expected_sha256:
            raise ArtifactConflict("dataset checksum mismatch")
        return pq.read_table(path).to_pylist()

    def read_dataset_range(
        self, relative_path: str, expected_sha256: str, *, from_utc: int, to_utc: int,
        max_bars: int, continue_check=None,
    ) -> list[dict]:
        path = (self.root / relative_path).resolve()
        if self.root not in path.parents:
            raise ValueError("artifact path escapes root")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                if continue_check is not None:
                    continue_check()
                digest.update(block)
        if digest.hexdigest() != expected_sha256:
            raise ArtifactConflict("dataset checksum mismatch")
        rows = []
        with pq.ParquetFile(path) as parquet:
            for batch in parquet.iter_batches(batch_size=4096, columns=["timestamp", "open", "high", "low", "close"]):
                if continue_check is not None:
                    continue_check()
                for row in batch.to_pylist():
                    if from_utc <= row["timestamp"] < to_utc:
                        if len(rows) >= max_bars:
                            raise ValueError("run exceeded budget.max_bars")
                        rows.append(row)
        return rows

    def write_result(self, workspace_id: str, job_id: str, payload: dict) -> tuple[str, str]:
        safe_job = _safe_component(job_id, "job_id")
        results = self._workspace_dir(workspace_id, "results")
        target = results / f"{safe_job}.json"
        if target.exists() or (results / safe_job).exists():
            raise ArtifactConflict(f"result artifact already exists: {safe_job}")
        data = canonical_json_bytes(payload)
        temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        temp.write_bytes(data)
        os.replace(temp, target)
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
        attempt_dir = results / safe_job
        attempt_dir.mkdir(parents=True, exist_ok=True)
        token_key = hashlib.sha256(lease_token.encode("utf-8")).hexdigest()[:16]
        target = attempt_dir / f"attempt-{attempt_no:06d}-{token_key}.json"
        if target.exists():
            raise ArtifactConflict(f"result candidate already exists: {job_id} attempt {attempt_no}")
        data = canonical_json_bytes(payload)
        temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        temp.write_bytes(data)
        os.replace(temp, target)
        return str(target.relative_to(self.root)), hashlib.sha256(data).hexdigest()

    def quarantine_result_candidate(self, relative_path: str) -> str | None:
        source = (self.root / relative_path).resolve()
        if self.root not in source.parents:
            raise ValueError("artifact path escapes root")
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
        quarantine_dir = self.root / safe_workspace / "quarantine" / "results" / safe_job
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        target = quarantine_dir / source.name
        if not source.exists():
            return str(target.relative_to(self.root)) if target.exists() else None
        if target.exists():
            if not source.exists():
                return str(target.relative_to(self.root))
            raise ArtifactConflict(f"quarantine artifact already exists: {relative_path}")
        try:
            os.replace(source, target)
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
        path = (self.root / relative_path).resolve()
        if self.root not in path.parents:
            raise ValueError("artifact path escapes root")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_sha256:
            raise ArtifactConflict("result checksum mismatch")
        return json.loads(data)
