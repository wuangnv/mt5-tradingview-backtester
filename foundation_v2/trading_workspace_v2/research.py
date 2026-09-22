from __future__ import annotations

import threading
from uuid import uuid4

from .artifacts import ArtifactStore
from .contracts import DatasetManifest, DatasetSource, ResearchResult, utc_now_iso
from .retained import SourceSpec, compute_metrics_v2
from .store import ClaimedJob, PostgresStore, StaleJobAttempt


class ResearchService:
    def __init__(
        self,
        store: PostgresStore,
        artifacts: ArtifactStore,
        *,
        worker_id: str | None = None,
        lease_seconds: int = 30,
    ):
        self.store = store
        self.artifacts = artifacts
        self.worker_id = worker_id or f"research-{uuid4().hex}"
        self.lease_seconds = lease_seconds

    def register_dataset(
        self,
        *,
        workspace_id: str,
        source: DatasetSource,
        instrument_id: str,
        timeframe: str,
        rows: list[dict],
    ) -> DatasetManifest:
        SourceSpec.from_mapping(source.model_dump())
        if len(rows) < 2:
            raise ValueError("dataset requires at least two rows")
        ordered = sorted(rows, key=lambda row: int(row["timestamp"]))
        if ordered != rows:
            raise ValueError("dataset rows must be strictly ordered")
        timestamps = [int(row["timestamp"]) for row in rows]
        if len(set(timestamps)) != len(timestamps):
            raise ValueError("dataset timestamps must be unique")
        dataset_id = uuid4().hex
        self.store.ensure_workspace(workspace_id)
        path, checksum = self.artifacts.write_dataset(workspace_id, dataset_id, rows)
        manifest = DatasetManifest(
            dataset_id=dataset_id,
            workspace_id=workspace_id,
            source=source,
            instrument_id=instrument_id,
            timeframe=timeframe,
            row_count=len(rows),
            first_timestamp=timestamps[0],
            last_timestamp=timestamps[-1],
            artifact_path=path,
            artifact_sha256=checksum,
            created_at_utc=utc_now_iso(),
        )
        self.store.put_dataset(manifest)
        return manifest

    def create_job(self, *, workspace_id: str, dataset_id: str, strategy_version: str, starting_balance: float):
        manifest = self.store.get_dataset(workspace_id, dataset_id)
        if manifest is None:
            raise LookupError("dataset not found in workspace")
        disposition = str(manifest.quality.get("disposition") or "") if manifest.quality else ""
        if disposition and disposition != "pass":
            raise ValueError(f"dataset is not QA-approved: {disposition}")
        return self.store.create_job(workspace_id, dataset_id, strategy_version, starting_balance)

    def cancel_job(self, workspace_id: str, job_id: str):
        job = self.store.cancel_job(workspace_id, job_id)
        if job is not None and job.status == "canceled":
            self.artifacts.quarantine_job_candidates(workspace_id, job_id)
        return job

    def recover_stale_jobs(self) -> list[dict]:
        recovered = self.store.recover_expired_jobs()
        cleanup = {
            (item["workspace_id"], item["job_id"])
            for item in self.store.terminal_jobs_requiring_candidate_cleanup()
        }
        for item in recovered:
            cleanup.add((item["workspace_id"], item["job_id"]))
        for workspace_id, job_id in sorted(cleanup):
            self.artifacts.quarantine_job_candidates(workspace_id, job_id)
        return recovered

    def _honor_cancel(self, job: ClaimedJob) -> bool:
        if not self.store.is_cancel_requested(job.workspace_id, job.job_id):
            return False
        if self.store.mark_canceled(job):
            return True
        self.recover_stale_jobs()
        current = self.store.get_job(job.workspace_id, job.job_id)
        if current is not None and current.status == "canceled":
            return True
        raise StaleJobAttempt("cancel observed by an attempt that no longer owns the job")

    def _lease_guard(self, job: ClaimedJob):
        return _LeaseGuard(self, job)

    def execute_claimed(self, job: ClaimedJob) -> ResearchResult | None:
        if self._honor_cancel(job):
            return None
        with self._lease_guard(job) as lease_guard:
            manifest = self.store.get_dataset(job.workspace_id, job.dataset_id)
            if manifest is None:
                raise LookupError("claimed dataset missing")
            rows = self.artifacts.read_dataset(manifest.artifact_path, manifest.artifact_sha256)
            if not lease_guard.owned():
                return None
            if job.strategy_version != "close-delta-v1":
                raise ValueError("unsupported strategy version")
            ledger = []
            for index in range(1, len(rows)):
                if not lease_guard.owned():
                    return None
                previous = float(rows[index - 1]["close"])
                current = float(rows[index]["close"])
                net_pnl = round((current - previous) * 100.0, 8)
                ledger.append(
                    {
                        "trade_id": f"{job.job_id}-{index}",
                        "net_pnl": net_pnl,
                        "gross_pnl": net_pnl,
                        "fees": 0.0,
                        "planned_risk_budget": 100.0,
                    }
                )
            metrics = compute_metrics_v2(ledger, job.starting_balance)
            if not lease_guard.owned():
                return None
            result = ResearchResult(
                job_id=job.job_id,
                workspace_id=job.workspace_id,
                dataset_id=job.dataset_id,
                dataset_sha256=manifest.artifact_sha256,
                strategy_version=job.strategy_version,
                metrics_schema_version=str(metrics["metric_schema_version"]),
                metrics=metrics,
                trade_count=len(ledger),
                created_at_utc=utc_now_iso(),
            )
            path, checksum = self.artifacts.write_result_candidate(
                job.workspace_id,
                job.job_id,
                job.attempt_no,
                job.lease_token,
                result.model_dump(mode="json"),
            )
            if not lease_guard.owned():
                self.artifacts.quarantine_result_candidate(path)
                return None
        try:
            completed = self.store.complete_job(job, path, checksum)
        except Exception:
            self.artifacts.quarantine_result_candidate(path)
            raise
        if not completed:
            self.artifacts.quarantine_result_candidate(path)
            return None
        return result

    def run_one(self) -> ResearchResult | None:
        self.recover_stale_jobs()
        job = self.store.claim_next_job(self.worker_id, self.lease_seconds)
        if job is None:
            return None
        try:
            return self.execute_claimed(job)
        except Exception:
            self.store.fail_job(job, "WORKER_EXECUTION_FAILED")
            raise

    def get_result(self, workspace_id: str, job_id: str) -> dict | None:
        job = self.store.get_job(workspace_id, job_id)
        if job is None or job.status != "completed" or not job.result_path or not job.result_sha256:
            return None
        return self.artifacts.read_json(job.result_path, job.result_sha256)


class _LeaseGuard:
    def __init__(self, service: ResearchService, job: ClaimedJob):
        self.service = service
        self.job = job
        self.interval = max(0.1, min(10.0, service.lease_seconds / 3))
        self.stop_event = threading.Event()
        self.lost_event = threading.Event()
        self.error: Exception | None = None
        self.thread: threading.Thread | None = None

    def __enter__(self):
        if not self.service.store.renew_job_lease(self.job, self.service.lease_seconds):
            if self.service._honor_cancel(self.job):
                self.lost_event.set()
                return self
            raise StaleJobAttempt("job lease is no longer owned")
        self.thread = threading.Thread(target=self._heartbeat, name=f"lease-{self.job.job_id}", daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=max(1.0, self.interval * 2))

    def _heartbeat(self) -> None:
        while not self.stop_event.wait(self.interval):
            try:
                if not self.service.store.renew_job_lease(self.job, self.service.lease_seconds):
                    self.lost_event.set()
                    return
            except Exception as exc:
                self.error = exc
                self.lost_event.set()
                return

    def owned(self) -> bool:
        if not self.lost_event.is_set():
            if self.service._honor_cancel(self.job):
                self.lost_event.set()
                return False
            return True
        if self.service._honor_cancel(self.job):
            return False
        if self.error is not None:
            raise RuntimeError("job lease heartbeat failed") from self.error
        raise StaleJobAttempt("job lease was lost during execution")
