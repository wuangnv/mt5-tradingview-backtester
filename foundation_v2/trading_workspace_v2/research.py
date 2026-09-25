from __future__ import annotations

import hashlib
import json
import threading
import time
from copy import deepcopy
from uuid import uuid4

from .artifacts import ArtifactStore, canonical_json_bytes
from .contracts import DatasetManifest, DatasetSource, EngineResearchResult, OOSResearchResult, ResearchResult, utc_now_iso
from .research_engine import (
    ENGINE_VERSION,
    ResearchEngineInterrupted,
    ResearchEngineValidationError,
    engine_code_sha256,
    execute_breakout,
    validate_rules,
    verify_engine_code,
)
from .nautilus_worker import (
    ADAPTER_VERSION,
    NAUTILUS_VERSION,
    adapter_hash,
    execute_native_process,
    normalize_native_result,
    runtime_identity,
    runtime_ready,
)
from .research_validation import ResearchReconciliationError, validate_engine_result
from .research_oos import build_bounded_sweep, build_walk_forward_plan, summarize_sweep_outcomes
from .retained import CostModel, InstrumentSpec, SourceSpec, compute_metrics_v2
from .store import ClaimedJob, PostgresStore, StaleJobAttempt


def _engine_dataset_snapshot(manifest):
    return {key: getattr(manifest, key) for key in (
        "dataset_id", "artifact_sha256", "normalized_sha256", "instrument_spec", "timeframe_seconds",
        "transform_version", "quality", "holdout_policy",
    )} | {"source": manifest.source.model_dump(mode="json")}


def _check_holdout(manifest, end):
    holdout = manifest.holdout_policy or {"mode": "none"}
    if holdout.get("mode") == "none":
        return
    boundary = holdout.get("from_utc")
    if holdout.get("mode") != "metadata_only" or boundary is None:
        raise PermissionError("dataset holdout policy is invalid")
    # Current U2 artifacts must be entirely pre-holdout, including the final bar.
    if end > int(boundary) or manifest.last_timestamp + int(manifest.timeframe_seconds or 0) > int(boundary):
        raise PermissionError("requested research data reaches locked holdout data")


def _canonical_oos_validation(rows, manifest, rules: dict, walk_forward: dict, parameter_space: dict, max_trials: int):
    if not isinstance(walk_forward, dict):
        raise ValueError("walk_forward must be structured")
    allowed_walk_forward = {
        "train_bars", "oos_bars", "step_bars", "purge_bars", "embargo_bars",
        "overlap_bars", "expanding", "max_folds",
    }
    unknown_walk_forward = sorted(set(walk_forward) - allowed_walk_forward)
    if unknown_walk_forward:
        raise ValueError(f"unsupported walk_forward fields: {', '.join(unknown_walk_forward)}")
    if not isinstance(parameter_space, dict):
        raise ValueError("parameter_space must be structured")
    unknown_parameters = sorted(set(parameter_space) - set(rules))
    if unknown_parameters:
        raise ValueError(f"parameter sweep references unsupported playbook rules: {', '.join(unknown_parameters)}")

    plan = build_walk_forward_plan(
        rows,
        timeframe_seconds=int(manifest.timeframe_seconds),
        holdout_policy=manifest.holdout_policy,
        **walk_forward,
    )
    sweep = build_bounded_sweep(parameter_space, max_trials=max_trials)
    for trial in sweep["trials"]:
        validate_rules({**rules, **trial["parameters"]})

    walk_forward_request = {
        "train_bars": plan["train_bars"],
        "oos_bars": plan["oos_bars"],
        "step_bars": plan["step_bars"],
        "purge_bars": plan["purge_bars"],
        "embargo_bars": plan["embargo_bars"],
        "overlap_bars": plan["overlap_bars"],
        "expanding": plan["expanding"],
        "max_folds": int(walk_forward.get("max_folds", 20)),
    }
    return {
        "schema": "research-oos-validation-v1",
        "holdout_access": False,
        "selection": {
            "mode": "none",
            "objective": None,
            "ranking": False,
            "winner": None,
            "automatic_selection": False,
            "reason": "objective_not_predeclared",
        },
        "walk_forward_request": walk_forward_request,
        "walk_forward": plan,
        "sweep_request": {"parameter_space": parameter_space, "max_trials": sweep["max_trials"]},
        "sweep": sweep,
    }


def _verify_oos_validation(protocol: dict, rows: list[dict], manifest) -> dict | None:
    validation = protocol.get("validation")
    if validation is None:
        return None
    if not isinstance(validation, dict) or validation.get("schema") != "research-oos-validation-v1":
        raise ResearchEngineValidationError("research validation protocol is invalid")
    if validation.get("holdout_access") is not False:
        raise ResearchEngineValidationError("research validation protocol cannot authorize holdout content")
    walk_forward = validation.get("walk_forward_request")
    sweep_request = validation.get("sweep_request")
    if not isinstance(walk_forward, dict) or not isinstance(sweep_request, dict):
        raise ResearchEngineValidationError("research validation protocol is incomplete")
    try:
        rebuilt = _canonical_oos_validation(
            rows,
            manifest,
            protocol.get("playbook", {}).get("rules") or {},
            walk_forward,
            sweep_request.get("parameter_space"),
            sweep_request.get("max_trials"),
        )
    except (TypeError, ValueError) as exc:
        raise ResearchEngineValidationError("research validation protocol cannot be reconstructed") from exc
    if rebuilt != validation:
        raise ResearchEngineValidationError("research validation protocol changed after job creation")
    return validation


class ResearchService:
    def __init__(
        self,
        store: PostgresStore,
        artifacts: ArtifactStore,
        *,
        worker_id: str | None = None,
        lease_seconds: int = 30,
        max_active_jobs: int | None = None,
    ):
        self.store = store
        self.artifacts = artifacts
        self.worker_id = worker_id or f"research-{uuid4().hex}"
        self.lease_seconds = lease_seconds
        if max_active_jobs is not None and max_active_jobs <= 0:
            raise ValueError("max_active_jobs must be positive")
        self.max_active_jobs = max_active_jobs

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

    def create_engine_job(
        self,
        *,
        workspace_id: str,
        request,
        walk_forward: dict | None = None,
        parameter_space: dict | None = None,
        max_trials: int | None = None,
    ) -> object:
        manifest = self.store.get_dataset(workspace_id, request.dataset_id)
        if manifest is None:
            raise LookupError("dataset_not_found")
        disposition = str(manifest.quality.get("disposition") or "") if manifest.quality else ""
        if disposition != "pass":
            raise ValueError(f"dataset is not QA-approved: {disposition or 'unknown'}")
        if manifest.instrument_spec is None or manifest.timeframe_seconds is None:
            raise ValueError("dataset is missing instrument/timeframe snapshot required by engine")

        playbook = self.store.get_record_revision(
            workspace_id, "playbook", request.playbook_id, request.playbook_revision
        )
        if playbook is None or playbook["deleted"]:
            raise LookupError("playbook_revision_not_found")
        payload = playbook["payload"]
        if payload.get("status") != "frozen":
            raise ValueError("engine research requires an exact frozen playbook revision")
        if payload.get("execution_capability") != "engine-supported":
            raise ValueError("playbook revision is not engine-supported")
        rules = payload.get("rules") or {}
        validate_rules(rules)
        if rules.get("exit_mode", "fixed_horizon") == "protective" and request.research_leverage is None:
            raise ValueError("protective research requires research_leverage")

        if int(request.data_to_utc) <= int(request.data_from_utc):
            raise ValueError("data_to_utc must be greater than data_from_utc")
        available_end = int(manifest.last_timestamp) + int(manifest.timeframe_seconds)
        if int(request.data_from_utc) < int(manifest.first_timestamp) or int(request.data_to_utc) > available_end:
            raise ValueError("requested research range exceeds dataset available range")
        _check_holdout(manifest, int(request.data_to_utc))

        instrument = InstrumentSpec.from_mapping(manifest.instrument_spec)
        allowed_costs = set(CostModel.__dataclass_fields__)
        if set(request.cost_model) - allowed_costs:
            raise ValueError("unsupported cost model fields")
        if type(request.cost_model.get("rounding_decimals", 2)) is not int:
            raise ValueError("cost rounding_decimals must be an integer")
        cost_model = CostModel.from_mapping(request.cost_model)
        if cost_model.account_ccy != instrument.account_ccy:
            raise ValueError("cost model account currency does not match instrument snapshot")
        if request.engine_backend == "nautilus":
            if not runtime_ready():
                raise ValueError("isolated Nautilus runtime is unavailable")
            if instrument.asset_class != "fx" or instrument.account_ccy != instrument.quote_ccy:
                raise ValueError("Nautilus FX adapter requires account currency equal to quote currency")
            native_runtime_identity = runtime_identity()
        else:
            native_runtime_identity = None

        parameters = {
            "spread_price": float(request.spread_price),
            "cost_model": request.cost_model,
        }
        if request.research_leverage is not None:
            parameters["research_margin"] = {
                "version": "fixed-starting-balance-leverage-v1",
                "leverage": float(request.research_leverage),
            }

        protocol = {
            "schema_version": "research-protocol-v1",
            "playbook": {
                "record_id": request.playbook_id,
                "revision": int(request.playbook_revision),
                "name": payload.get("name"),
                "execution_capability": payload.get("execution_capability"),
                "rules": rules,
            },
            "dataset": _engine_dataset_snapshot(manifest),
            "range": {"from_utc": int(request.data_from_utc), "to_utc": int(request.data_to_utc)},
            "split": request.split,
            "starting_balance": float(request.starting_balance),
            "seed": int(request.seed),
            "parameters": parameters,
            "engine": {"version": ENGINE_VERSION, "code_sha256": engine_code_sha256(), "backend": request.engine_backend,
                       **({"native_version": NAUTILUS_VERSION, "adapter_version": ADAPTER_VERSION,
                           "adapter_sha256": adapter_hash(), "runtime_identity": native_runtime_identity}
                          if request.engine_backend == "nautilus" else {})},
            "budget": {"max_bars": int(request.max_bars), "max_runtime_ms": int(request.max_runtime_ms), "max_memory_mb": request.max_memory_mb},
        }
        requested_oos = (walk_forward is not None, parameter_space is not None, max_trials is not None)
        if any(requested_oos):
            if not all(requested_oos):
                raise ValueError("walk_forward, parameter_space and max_trials must be provided together")
            if request.split != "validation":
                raise ValueError("OOS configuration requires split=validation")
            rows = self.artifacts.read_dataset_range(
                manifest.artifact_path,
                manifest.artifact_sha256,
                from_utc=int(request.data_from_utc),
                to_utc=int(request.data_to_utc),
                max_bars=int(request.max_bars),
            )
            protocol["validation"] = _canonical_oos_validation(
                rows,
                manifest,
                rules,
                walk_forward,
                parameter_space,
                max_trials,
            )
        protocol_sha256 = hashlib.sha256(canonical_json_bytes(protocol)).hexdigest()
        return self.store.create_engine_job(
            workspace_id,
            manifest.dataset_id,
            float(request.starting_balance),
            protocol,
            protocol_sha256,
        )

    def create_oos_engine_job(
        self,
        *,
        workspace_id: str,
        request,
        walk_forward: dict,
        parameter_space: dict,
        max_trials: int,
    ) -> object:
        return self.create_engine_job(
            workspace_id=workspace_id,
            request=request,
            walk_forward=walk_forward,
            parameter_space=parameter_space,
            max_trials=max_trials,
        )

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

    def execute_claimed(self, job: ClaimedJob) -> ResearchResult | EngineResearchResult | OOSResearchResult | None:
        if self._honor_cancel(job):
            return None
        with self._lease_guard(job) as lease_guard:
            phase_count = 5 if job.protocol is not None and job.protocol.get("validation") is not None else 4
            manifest = self.store.get_dataset(job.workspace_id, job.dataset_id)
            if manifest is None:
                raise LookupError("claimed dataset missing")
            if not lease_guard.owned():
                return None
            if not self.save_checkpoint(
                job,
                {
                    "schema": "research-job-checkpoint-v1",
                    "phase": "claimed",
                    "attempt_no": job.attempt_no,
                    "dataset_id": job.dataset_id,
                },
                {"phase_index": 0, "phase_count": phase_count},
            ):
                return None
            if job.protocol is not None:
                if not job.protocol_sha256:
                    raise ResearchEngineValidationError("engine job is missing protocol hash")
                actual_protocol_hash = hashlib.sha256(canonical_json_bytes(job.protocol)).hexdigest()
                if actual_protocol_hash != job.protocol_sha256:
                    raise ResearchEngineValidationError("queued protocol hash mismatch")
                _check_holdout(manifest, int(job.protocol["range"]["to_utc"]))
                if job.protocol.get("dataset") != _engine_dataset_snapshot(manifest):
                    raise ResearchEngineValidationError("dataset snapshot changed after job creation")
                if not self.save_checkpoint(
                    job,
                    {
                        "schema": "research-job-checkpoint-v1",
                        "phase": "protocol-validated",
                        "attempt_no": job.attempt_no,
                        "protocol_sha256": job.protocol_sha256,
                    },
                    {"phase_index": 1, "phase_count": phase_count},
                ):
                    return None
                started = time.perf_counter()
                deadline = started + int(job.protocol["budget"]["max_runtime_ms"]) / 1000

                def check_budget():
                    if time.perf_counter() >= deadline:
                        raise ResearchEngineValidationError("run exceeded budget.max_runtime_ms")
                    if not lease_guard.owned():
                        raise ResearchEngineInterrupted("research execution interrupted")

                try:
                    rows = self.artifacts.read_dataset_range(
                        manifest.artifact_path, manifest.artifact_sha256,
                        from_utc=job.protocol["range"]["from_utc"], to_utc=job.protocol["range"]["to_utc"],
                        max_bars=job.protocol["budget"]["max_bars"], continue_check=check_budget,
                    )
                    if not self.save_checkpoint(
                        job,
                        {
                            "schema": "research-job-checkpoint-v1",
                            "phase": "dataset-loaded",
                            "attempt_no": job.attempt_no,
                            "row_count": len(rows),
                            "from_utc": job.protocol["range"]["from_utc"],
                            "to_utc": job.protocol["range"]["to_utc"],
                        },
                        {"phase_index": 2, "phase_count": phase_count},
                    ):
                        return None
                    validation = _verify_oos_validation(job.protocol, rows, manifest)
                    if validation is not None:
                        if not self.save_checkpoint(
                            job,
                            {
                                "schema": "research-job-checkpoint-v1",
                                "phase": "oos-validation-verified",
                                "attempt_no": job.attempt_no,
                                "validation_schema": validation["schema"],
                                "holdout_access": False,
                                "fold_count": validation["walk_forward"]["fold_count"],
                                "trial_count": validation["sweep"]["trial_count"],
                                "sweep_truncated": validation["sweep"]["truncated"],
                            },
                            {"phase_index": 3, "phase_count": phase_count},
                        ):
                            return None
                    verify_engine_code(job.protocol)

                    def run_engine(slice_rows: list[dict], slice_protocol: dict) -> dict:
                        check_budget()
                        if slice_protocol["engine"].get("backend", "reference") == "nautilus":
                            native = execute_native_process(
                                slice_rows,
                                slice_protocol,
                                continue_check=lease_guard.owned,
                                deadline=deadline,
                            )
                            engine_result = normalize_native_result(native, slice_protocol)
                        else:
                            engine_result = execute_breakout(
                                slice_rows,
                                slice_protocol,
                                continue_check=lease_guard.owned,
                                deadline=deadline,
                            )
                        slice_protocol_sha256 = hashlib.sha256(canonical_json_bytes(slice_protocol)).hexdigest()
                        slice_result = EngineResearchResult(
                            job_id=job.job_id,
                            workspace_id=job.workspace_id,
                            dataset_id=job.dataset_id,
                            dataset_sha256=manifest.artifact_sha256,
                            protocol_sha256=slice_protocol_sha256,
                            protocol=slice_protocol,
                            playbook_id=slice_protocol["playbook"]["record_id"],
                            playbook_revision=int(slice_protocol["playbook"]["revision"]),
                            engine_code_sha256=slice_protocol["engine"]["code_sha256"],
                            split=slice_protocol["split"],
                            assumptions=engine_result["assumptions"],
                            signals=engine_result["signals"],
                            ledger=engine_result["ledger"],
                            metrics=engine_result["metrics"],
                            observed_range=engine_result["observed_range"],
                            execution=engine_result.get("execution", {}),
                            created_at_utc=utc_now_iso(),
                        )
                        validate_engine_result(
                            slice_result.model_dump(mode="json"),
                            rows=slice_rows,
                            continue_check=check_budget,
                        )
                        check_budget()
                        return engine_result

                    if validation is None:
                        engine = run_engine(rows, job.protocol)
                    else:
                        trial_results = []
                        terminal_outcomes = []
                        for trial in validation["sweep"]["trials"]:
                            check_budget()
                            trial_result = {
                                "trial_id": trial["trial_id"],
                                "parameters": trial["parameters"],
                                "status": "completed",
                                "folds": [],
                            }
                            for fold in validation["walk_forward"]["folds"]:
                                fold_result = {"fold": fold["fold"], "status": "completed"}
                                for segment_name, split in (("train", "train"), ("oos", "validation")):
                                    planned_range = fold[segment_name]
                                    start = int(planned_range["start_index"])
                                    stop = int(planned_range["stop_index"])
                                    slice_rows = rows[start:stop]
                                    slice_protocol = deepcopy(job.protocol)
                                    slice_protocol.pop("validation", None)
                                    slice_protocol["split"] = split
                                    slice_protocol["range"] = {
                                        "from_utc": int(planned_range["from_utc"]),
                                        "to_utc": int(planned_range["to_utc"]),
                                    }
                                    slice_protocol["playbook"]["rules"] = {
                                        **job.protocol["playbook"]["rules"],
                                        **trial["parameters"],
                                    }
                                    try:
                                        engine_result = run_engine(slice_rows, slice_protocol)
                                        fold_result[segment_name] = {
                                            "status": "completed",
                                            "metrics": engine_result["metrics"],
                                            "signals": engine_result["signals"],
                                            "trade_count": len(engine_result["ledger"]),
                                            "observed_range": engine_result["observed_range"],
                                        }
                                    except ResearchEngineInterrupted:
                                        raise
                                    except ResearchEngineValidationError as exc:
                                        if str(exc) == "run exceeded budget.max_runtime_ms":
                                            raise
                                        fold_result[segment_name] = {
                                            "status": "failed",
                                            "error": str(exc)[:500],
                                        }
                                        fold_result["status"] = "failed"
                                        trial_result["status"] = "failed"
                                    except ResearchReconciliationError as exc:
                                        fold_result[segment_name] = {
                                            "status": "failed",
                                            "error": str(exc)[:500],
                                        }
                                        fold_result["status"] = "failed"
                                        trial_result["status"] = "failed"
                                trial_result["folds"].append(fold_result)
                            terminal_outcomes.append(
                                {"trial_id": trial_result["trial_id"], "status": trial_result["status"]}
                            )
                            trial_results.append(trial_result)
                        outcome_summary = summarize_sweep_outcomes(validation["sweep"], terminal_outcomes)
                        engine = None
                except ResearchEngineInterrupted:
                    return None
                elapsed_ms = (time.perf_counter() - started) * 1000.0
                if elapsed_ms > int(job.protocol["budget"]["max_runtime_ms"]):
                    raise ResearchEngineValidationError("run exceeded budget.max_runtime_ms")
                if validation is None:
                    result = EngineResearchResult(
                        job_id=job.job_id,
                        workspace_id=job.workspace_id,
                        dataset_id=job.dataset_id,
                        dataset_sha256=manifest.artifact_sha256,
                        protocol_sha256=job.protocol_sha256,
                        protocol=job.protocol,
                        playbook_id=job.protocol["playbook"]["record_id"],
                        playbook_revision=int(job.protocol["playbook"]["revision"]),
                        engine_code_sha256=job.protocol["engine"]["code_sha256"],
                        split=job.protocol["split"],
                        assumptions=engine["assumptions"],
                        signals=engine["signals"],
                        ledger=engine["ledger"],
                        metrics=engine["metrics"],
                        observed_range={**engine["observed_range"], "elapsed_ms": round(elapsed_ms, 3)},
                        execution=engine.get("execution", {}),
                        created_at_utc=utc_now_iso(),
                    )
                    result_checkpoint = {"trade_count": len(result.ledger)}
                else:
                    result = OOSResearchResult(
                        job_id=job.job_id,
                        workspace_id=job.workspace_id,
                        dataset_id=job.dataset_id,
                        dataset_sha256=manifest.artifact_sha256,
                        protocol_sha256=job.protocol_sha256,
                        protocol=job.protocol,
                        playbook_id=job.protocol["playbook"]["record_id"],
                        playbook_revision=int(job.protocol["playbook"]["revision"]),
                        engine_code_sha256=job.protocol["engine"]["code_sha256"],
                        selection=validation["selection"],
                        walk_forward=validation["walk_forward"],
                        sweep=validation["sweep"],
                        trials=trial_results,
                        outcome_summary=outcome_summary,
                        source_range={
                            "from_utc": int(job.protocol["range"]["from_utc"]),
                            "to_utc": int(job.protocol["range"]["to_utc"]),
                            "bar_count": len(rows),
                            "elapsed_ms": round(elapsed_ms, 3),
                        },
                        created_at_utc=utc_now_iso(),
                    )
                    result_checkpoint = {"trial_status_counts": outcome_summary["status_counts"]}
                payload = result.model_dump(mode="json")
                if not self.save_checkpoint(
                    job,
                    {
                        "schema": "research-job-checkpoint-v1",
                        "phase": "result-validated",
                        "attempt_no": job.attempt_no,
                        **result_checkpoint,
                    },
                    {"phase_index": phase_count - 1, "phase_count": phase_count},
                ):
                    return None
                path, checksum = self.artifacts.write_result_candidate(
                    job.workspace_id,
                    job.job_id,
                    job.attempt_no,
                    job.lease_token,
                    payload,
                )
                try:
                    check_budget()
                except ResearchEngineInterrupted:
                    self.artifacts.quarantine_result_candidate(path)
                    return None
                except Exception:
                    self.artifacts.quarantine_result_candidate(path)
                    raise
                if not self.save_checkpoint(
                    job,
                    {
                        "schema": "research-job-checkpoint-v1",
                        "phase": "candidate-ready",
                        "attempt_no": job.attempt_no,
                        "result_sha256": checksum,
                    },
                    {"phase_index": phase_count, "phase_count": phase_count},
                ):
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
            if job.strategy_version != "close-delta-v1":
                raise ValueError("unsupported strategy version")
            rows = self.artifacts.read_dataset(manifest.artifact_path, manifest.artifact_sha256)
            if not self.save_checkpoint(
                job,
                {
                    "schema": "research-job-checkpoint-v1",
                    "phase": "dataset-loaded",
                    "attempt_no": job.attempt_no,
                    "row_count": len(rows),
                },
                {"phase_index": 2, "phase_count": 4},
            ):
                return None
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
            if not self.save_checkpoint(
                job,
                {
                    "schema": "research-job-checkpoint-v1",
                    "phase": "candidate-ready",
                    "attempt_no": job.attempt_no,
                    "result_sha256": checksum,
                },
                {"phase_index": 4, "phase_count": 4},
            ):
                self.artifacts.quarantine_result_candidate(path)
                return None
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

    def run_one(self) -> ResearchResult | EngineResearchResult | None:
        self.recover_stale_jobs()
        job = self.store.claim_next_job(
            self.worker_id,
            self.lease_seconds,
            max_active_jobs=self.max_active_jobs,
        )
        if job is None:
            return None
        try:
            return self.execute_claimed(job)
        except Exception:
            self.store.fail_job(job, "WORKER_EXECUTION_FAILED")
            raise

    def save_checkpoint(self, job: ClaimedJob, checkpoint: dict, progress: dict | None = None) -> bool:
        return self.store.update_job_checkpoint(job, checkpoint=checkpoint, progress=progress)

    def resume_checkpoint(self, workspace_id: str, job_id: str) -> dict | None:
        return self.store.get_job_checkpoint(workspace_id, job_id)

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
