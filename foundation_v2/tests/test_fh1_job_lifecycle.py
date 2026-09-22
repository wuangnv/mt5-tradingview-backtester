from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.store import PostgresStore, StaleJobAttempt


def fixture_source() -> DatasetSource:
    return DatasetSource(
        source_id="fh1-fixture",
        provider="synthetic-fh1",
        instrument_mapping={"EURUSD": "EURUSD"},
        license_use="qa-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="fh1-lifecycle-v1",
    )


def fixture_rows() -> list[dict]:
    return [
        {
            "timestamp": 1_720_000_000 + index * 60,
            "open": 1.0,
            "high": max(1.0, close) + 0.0002,
            "low": min(1.0, close) - 0.0002,
            "close": close,
            "volume": 100 + index,
        }
        for index, close in enumerate((1.0000, 1.0004, 1.0001, 1.0008))
    ]


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL"), "FH-1 PostgreSQL fixture not configured")
class FH1JobLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]

    def setUp(self):
        if os.getenv("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB") != "1":
            self.fail("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB=1 is required for TRUNCATE fixture tests")
        self.temp = tempfile.TemporaryDirectory(prefix="tw-fh1-")
        self.store = PostgresStore(self.dsn)
        self.store.initialize()
        with self.store.connect() as conn:
            conn.execute("TRUNCATE workspace_record_revisions,workspace_records,research_jobs,datasets,workspaces CASCADE")
            conn.commit()
        self.artifacts = ArtifactStore(self.temp.name)
        self.service = ResearchService(self.store, self.artifacts, worker_id="fh1-service", lease_seconds=60)
        self.dataset = self.service.register_dataset(
            workspace_id="tenant-a",
            source=fixture_source(),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=fixture_rows(),
        )

    def tearDown(self):
        self.temp.cleanup()

    def create_job(self):
        return self.service.create_job(
            workspace_id="tenant-a",
            dataset_id=self.dataset.dataset_id,
            strategy_version="close-delta-v1",
            starting_balance=10_000,
        )

    def expire(self, job_id: str) -> None:
        with self.store.connect() as conn:
            conn.execute(
                """
                UPDATE research_jobs
                SET lease_expires_at_utc=CURRENT_TIMESTAMP - INTERVAL '1 second'
                WHERE workspace_id='tenant-a' AND job_id=%s
                """,
                (job_id,),
            )
            conn.commit()

    def test_cancel_before_finalize_wins_and_candidate_is_not_authoritative(self):
        job = self.create_job()
        claimed = self.store.claim_next_job("worker-a", 60)
        self.assertEqual(claimed.job_id, job.job_id)
        path, checksum = self.artifacts.write_result_candidate(
            claimed.workspace_id,
            claimed.job_id,
            claimed.attempt_no,
            claimed.lease_token,
            {"winner": "should-not-publish"},
        )

        canceled = self.store.cancel_job("tenant-a", job.job_id)
        self.assertTrue(canceled.cancel_requested)
        self.assertFalse(self.store.complete_job(claimed, path, checksum))

        current = self.store.get_job("tenant-a", job.job_id)
        self.assertEqual(current.status, "canceled")
        self.assertIsNone(current.result_path)
        self.assertIsNone(self.service.get_result("tenant-a", job.job_id))
        self.assertTrue((Path(self.temp.name) / path).exists())

    def test_complete_before_cancel_wins(self):
        job = self.create_job()
        claimed = self.store.claim_next_job("worker-a", 60)
        path, checksum = self.artifacts.write_result_candidate(
            claimed.workspace_id,
            claimed.job_id,
            claimed.attempt_no,
            claimed.lease_token,
            {"winner": "complete"},
        )

        self.assertTrue(self.store.complete_job(claimed, path, checksum))
        after_cancel = self.store.cancel_job("tenant-a", job.job_id)
        self.assertEqual(after_cancel.status, "completed")
        self.assertFalse(after_cancel.cancel_requested)
        self.assertEqual(self.service.get_result("tenant-a", job.job_id), {"winner": "complete"})

    def test_crash_after_claim_requeues_and_stale_attempt_cannot_finalize(self):
        job = self.create_job()
        first = self.store.claim_next_job("worker-a", 60)
        self.expire(job.job_id)

        recovered = self.store.recover_expired_jobs()
        self.assertEqual(recovered[0]["status"], "queued")
        second = self.store.claim_next_job("worker-b", 60)
        self.assertEqual(second.job_id, job.job_id)
        self.assertEqual(second.attempt_no, first.attempt_no + 1)
        self.assertNotEqual(second.lease_token, first.lease_token)

        stale_path, stale_checksum = self.artifacts.write_result_candidate(
            first.workspace_id,
            first.job_id,
            first.attempt_no,
            first.lease_token,
            {"attempt": "stale"},
        )
        with self.assertRaises(StaleJobAttempt):
            self.store.complete_job(first, stale_path, stale_checksum)

        fresh_path, fresh_checksum = self.artifacts.write_result_candidate(
            second.workspace_id,
            second.job_id,
            second.attempt_no,
            second.lease_token,
            {"attempt": "fresh"},
        )
        self.assertTrue(self.store.complete_job(second, fresh_path, fresh_checksum))
        self.assertEqual(self.service.get_result("tenant-a", job.job_id), {"attempt": "fresh"})

    def test_crash_after_candidate_leaves_orphan_but_retry_can_publish(self):
        job = self.create_job()
        first = self.store.claim_next_job("worker-a", 60)
        orphan_path, _ = self.artifacts.write_result_candidate(
            first.workspace_id,
            first.job_id,
            first.attempt_no,
            first.lease_token,
            {"attempt": 1},
        )
        self.assertIsNone(self.service.get_result("tenant-a", job.job_id))
        self.expire(job.job_id)
        recovered = self.service.recover_stale_jobs()
        self.assertEqual(recovered[0]["status"], "queued")
        self.assertFalse((Path(self.temp.name) / orphan_path).exists())
        quarantined = list((Path(self.temp.name) / "tenant-a" / "quarantine" / "results" / job.job_id).glob("*.json"))
        self.assertEqual(len(quarantined), 1)

        second = self.store.claim_next_job("worker-b", 60)
        result_path, result_checksum = self.artifacts.write_result_candidate(
            second.workspace_id,
            second.job_id,
            second.attempt_no,
            second.lease_token,
            {"attempt": 2},
        )
        self.assertTrue(self.store.complete_job(second, result_path, result_checksum))

        self.assertNotEqual(orphan_path, result_path)
        self.assertEqual(self.service.get_result("tenant-a", job.job_id), {"attempt": 2})

    def test_expired_cancel_request_recovers_to_canceled_not_queued(self):
        job = self.create_job()
        self.store.claim_next_job("worker-a", 60)
        self.store.cancel_job("tenant-a", job.job_id)
        self.expire(job.job_id)

        recovered = self.store.recover_expired_jobs()
        self.assertEqual(recovered[0]["status"], "canceled")
        current = self.store.get_job("tenant-a", job.job_id)
        self.assertEqual(current.status, "canceled")
        self.assertIsNone(self.store.claim_next_job("worker-b", 60))

    def test_stale_worker_observing_cancel_terminalizes_expired_last_job(self):
        job = self.create_job()
        stale = self.store.claim_next_job("worker-a", 60)
        self.store.cancel_job("tenant-a", job.job_id)
        self.expire(job.job_id)

        self.assertIsNone(self.service.execute_claimed(stale))

        current = self.store.get_job("tenant-a", job.job_id)
        self.assertEqual(current.status, "canceled")
        self.assertIsNone(current.result_path)

    def test_cancel_and_complete_race_has_one_consistent_terminal_winner(self):
        job = self.create_job()
        claimed = self.store.claim_next_job("worker-a", 60)
        path, checksum = self.artifacts.write_result_candidate(
            claimed.workspace_id,
            claimed.job_id,
            claimed.attempt_no,
            claimed.lease_token,
            {"race": True},
        )
        barrier = threading.Barrier(2)

        def complete():
            barrier.wait()
            return PostgresStore(self.dsn).complete_job(claimed, path, checksum)

        def cancel():
            barrier.wait()
            return PostgresStore(self.dsn).cancel_job("tenant-a", job.job_id)

        with ThreadPoolExecutor(max_workers=2) as pool:
            complete_future = pool.submit(complete)
            cancel_future = pool.submit(cancel)
            completed = complete_future.result()
            canceled_view = cancel_future.result()

        current = self.store.get_job("tenant-a", job.job_id)
        self.assertIn(current.status, {"completed", "canceled"})
        self.assertEqual(canceled_view.status, current.status)
        if current.status == "completed":
            self.assertTrue(completed)
            self.assertEqual(self.service.get_result("tenant-a", job.job_id), {"race": True})
        else:
            self.assertFalse(completed)
            self.assertIsNone(self.service.get_result("tenant-a", job.job_id))

    def test_service_run_one_publishes_only_the_owned_attempt(self):
        job = self.create_job()

        result = self.service.run_one()

        self.assertEqual(result.job_id, job.job_id)
        current = self.store.get_job("tenant-a", job.job_id)
        self.assertEqual(current.status, "completed")
        self.assertIn(f"results/{job.job_id}/attempt-", current.result_path.replace("\\", "/"))
        published = self.service.get_result("tenant-a", job.job_id)
        self.assertEqual(published["job_id"], job.job_id)
        self.assertEqual(published["trade_count"], 3)

    def test_service_restart_reclaims_an_expired_running_job(self):
        job = self.create_job()
        stale = self.store.claim_next_job("crashed-worker", 60)
        self.expire(job.job_id)
        restarted = ResearchService(self.store, self.artifacts, worker_id="restart-worker", lease_seconds=60)

        result = restarted.run_one()

        self.assertEqual(result.job_id, job.job_id)
        current = self.store.get_job("tenant-a", job.job_id)
        self.assertEqual(current.status, "completed")
        with self.store.connect() as conn:
            attempt_no = conn.execute(
                "SELECT attempt_no FROM research_jobs WHERE workspace_id='tenant-a' AND job_id=%s",
                (job.job_id,),
            ).fetchone()["attempt_no"]
        self.assertEqual(int(attempt_no), stale.attempt_no + 1)

    def test_background_lease_heartbeat_prevents_reclaim_during_blocking_read(self):
        job = self.create_job()
        claimed = self.store.claim_next_job("slow-worker", 1)
        entered = threading.Event()
        release = threading.Event()
        original_read = self.artifacts.read_dataset

        def blocking_read(path, checksum):
            entered.set()
            if not release.wait(timeout=5):
                raise TimeoutError("test did not release blocking read")
            return original_read(path, checksum)

        self.artifacts.read_dataset = blocking_read
        slow_service = ResearchService(self.store, self.artifacts, worker_id="slow-worker", lease_seconds=1)
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(slow_service.execute_claimed, claimed)
            self.assertTrue(entered.wait(timeout=2))
            time.sleep(1.25)
            self.assertEqual(self.store.recover_expired_jobs(), [])
            release.set()
            result = future.result(timeout=5)

        self.assertEqual(result.job_id, job.job_id)
        self.assertEqual(self.store.get_job("tenant-a", job.job_id).status, "completed")

    def test_two_workers_cannot_claim_the_same_job(self):
        job = self.create_job()
        barrier = threading.Barrier(2)

        def claim(worker_id: str):
            barrier.wait()
            return PostgresStore(self.dsn).claim_next_job(worker_id, 60)

        with ThreadPoolExecutor(max_workers=2) as pool:
            claims = list(pool.map(claim, ("worker-a", "worker-b")))

        owned = [claimed for claimed in claims if claimed is not None]
        self.assertEqual(len(owned), 1)
        self.assertEqual(owned[0].job_id, job.job_id)


if __name__ == "__main__":
    unittest.main()
