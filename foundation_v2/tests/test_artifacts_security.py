from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.artifacts import ArtifactStore


class ArtifactPathSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tw-artifacts-safety-")
        self.root = Path(self.temp.name).resolve()
        self.store = ArtifactStore(self.root)
        self.rows = [{"timestamp": 1, "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0}]

    def tearDown(self):
        self.temp.cleanup()

    def test_workspace_and_dataset_ids_must_remain_single_components(self):
        for workspace_id in ("..", "tenant/escape", "tenant\\escape", "C:tenant"):
            with self.subTest(workspace_id=workspace_id):
                with self.assertRaisesRegex(ValueError, "workspace_id"):
                    self.store.write_dataset(workspace_id, "dataset-safe", self.rows)

        for dataset_id in ("..", "../escape", "..\\escape", "C:dataset"):
            with self.subTest(dataset_id=dataset_id):
                with self.assertRaisesRegex(ValueError, "dataset_id"):
                    self.store.write_dataset("tenant-safe", dataset_id, self.rows)

        self.assertFalse(any(self.root.parent.glob("escape.parquet")))

    def test_job_ids_are_checked_before_result_paths_are_created(self):
        for job_id in ("..", "../escape", "..\\escape", "C:job"):
            with self.subTest(job_id=job_id):
                with self.assertRaisesRegex(ValueError, "job_id"):
                    self.store.write_result("tenant-safe", job_id, {"ok": True})
                with self.assertRaisesRegex(ValueError, "job_id"):
                    self.store.write_result_candidate("tenant-safe", job_id, 1, "lease", {"ok": True})

    def test_valid_identifiers_keep_existing_artifact_layout(self):
        dataset_path, _ = self.store.write_dataset("tenant-safe", "dataset-safe", self.rows)
        result_path, _ = self.store.write_result("tenant-safe", "job-safe", {"ok": True})

        self.assertEqual(dataset_path.replace("\\", "/"), "tenant-safe/datasets/dataset-safe.parquet")
        self.assertEqual(result_path.replace("\\", "/"), "tenant-safe/results/job-safe.json")


if __name__ == "__main__":
    unittest.main()
