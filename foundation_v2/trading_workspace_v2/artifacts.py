from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

import pyarrow as pa
import pyarrow.parquet as pq


class ArtifactConflict(RuntimeError):
    pass


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
        safe = workspace_id.replace("/", "_").replace("\\", "_")
        path = self.root / safe / family
        path.mkdir(parents=True, exist_ok=True)
        return path

    def write_dataset(self, workspace_id: str, dataset_id: str, rows: list[dict]) -> tuple[str, str]:
        target = self._workspace_dir(workspace_id, "datasets") / f"{dataset_id}.parquet"
        if target.exists():
            raise ArtifactConflict(f"dataset artifact already exists: {dataset_id}")
        temp = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        table = pa.Table.from_pylist(rows)
        pq.write_table(table, temp, compression="zstd")
        os.replace(temp, target)
        return str(target.relative_to(self.root)), sha256_file(target)

    def read_dataset(self, relative_path: str, expected_sha256: str) -> list[dict]:
        path = (self.root / relative_path).resolve()
        if self.root not in path.parents:
            raise ValueError("artifact path escapes root")
        if sha256_file(path) != expected_sha256:
            raise ArtifactConflict("dataset checksum mismatch")
        return pq.read_table(path).to_pylist()

    def write_result(self, workspace_id: str, job_id: str, payload: dict) -> tuple[str, str]:
        results = self._workspace_dir(workspace_id, "results")
        target = results / f"{job_id}.json"
        if target.exists() or (results / job_id).exists():
            raise ArtifactConflict(f"result artifact already exists: {job_id}")
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
        results = self._workspace_dir(workspace_id, "results")
        legacy_target = results / f"{job_id}.json"
        if legacy_target.exists():
            raise ArtifactConflict(f"result artifact already exists: {job_id}")
        attempt_dir = results / job_id
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
        if not source.exists():
            return None
        workspace_id, _, job_id = parts[:3]
        quarantine_dir = self.root / workspace_id / "quarantine" / "results" / job_id
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        target = quarantine_dir / source.name
        if target.exists():
            raise ArtifactConflict(f"quarantine artifact already exists: {relative_path}")
        os.replace(source, target)
        try:
            source.parent.rmdir()
        except OSError:
            pass
        return str(target.relative_to(self.root))

    def quarantine_job_candidates(self, workspace_id: str, job_id: str) -> list[str]:
        safe_workspace = workspace_id.replace("/", "_").replace("\\", "_")
        attempt_dir = (self.root / safe_workspace / "results" / job_id).resolve()
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
