from __future__ import annotations

from uuid import uuid4

from .artifacts import ArtifactStore
from .store import PostgresStore


class ReplayService:
    def __init__(self, store: PostgresStore, artifacts: ArtifactStore):
        self.store = store
        self.artifacts = artifacts

    def _dataset_rows(self, workspace_id: str, dataset_id: str) -> tuple[object, list[dict]]:
        manifest = self.store.get_dataset(workspace_id, dataset_id)
        if manifest is None:
            raise LookupError("dataset not found")
        rows = self.artifacts.read_dataset(manifest.artifact_path, manifest.artifact_sha256)
        return manifest, rows

    def create(self, workspace_id: str, dataset_id: str, start_index: int = 0) -> dict:
        _, rows = self._dataset_rows(workspace_id, dataset_id)
        if start_index >= len(rows):
            raise ValueError("start_index exceeds dataset")
        payload = {
            "dataset_id": dataset_id,
            "cursor_index": int(start_index),
            "branch_id": uuid4().hex,
            "parent_session_id": None,
            "parent_revision": None,
            "status": "paused",
        }
        record = self.store.create_record(workspace_id, "replay", payload)
        return self.view(workspace_id, record["record_id"])

    def view(self, workspace_id: str, session_id: str) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        payload = record["payload"]
        manifest, rows = self._dataset_rows(workspace_id, payload["dataset_id"])
        cursor = int(payload["cursor_index"])
        if cursor >= len(rows):
            raise RuntimeError("replay cursor exceeds immutable dataset")
        visible = rows[: cursor + 1]
        return {
            **record,
            "dataset_sha256": manifest.artifact_sha256,
            "cutoff_timestamp": int(visible[-1]["timestamp"]),
            "visible_rows": visible,
            "visible_row_count": len(visible),
            "total_row_count": len(rows),
            "has_future_rows": cursor + 1 < len(rows),
        }

    def step(self, workspace_id: str, session_id: str, expected_revision: int, steps: int = 1) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        payload = dict(record["payload"])
        _, rows = self._dataset_rows(workspace_id, payload["dataset_id"])
        cursor = min(len(rows) - 1, int(payload["cursor_index"]) + int(steps))
        payload["cursor_index"] = cursor
        payload["status"] = "completed" if cursor == len(rows) - 1 else "paused"
        self.store.update_record(workspace_id, "replay", session_id, expected_revision, payload)
        return self.view(workspace_id, session_id)

    def branch(self, workspace_id: str, session_id: str, expected_revision: int, cursor_index: int) -> dict:
        record = self.store.get_record(workspace_id, "replay", session_id)
        if record is None:
            raise LookupError("replay session not found")
        if record["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        current_cursor = int(record["payload"]["cursor_index"])
        if cursor_index > current_cursor:
            raise ValueError("branch cursor cannot exceed current replay cursor")
        payload = {
            "dataset_id": record["payload"]["dataset_id"],
            "cursor_index": int(cursor_index),
            "branch_id": uuid4().hex,
            "parent_session_id": session_id,
            "parent_revision": int(expected_revision),
            "status": "paused",
        }
        branched = self.store.create_record(workspace_id, "replay", payload)
        return self.view(workspace_id, branched["record_id"])
