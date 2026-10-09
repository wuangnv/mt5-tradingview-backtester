from __future__ import annotations

import io
import os
import sys
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

import pyarrow.parquet as pq
import pytest

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]

from trading_workspace_v2.artifacts import ArtifactConflict, ArtifactStore, sha256_file
from trading_workspace_v2.artifact_backup import (
    S3BackupRepository, create_backup_bundle, restore_backup_files, verify_backup_bundle,
)
from trading_workspace_v2.data_ingest import DataIngestService


def rows(count=100):
    return [{"timestamp": n, "open": float(n), "high": float(n + 1), "low": float(n - 1), "close": float(n), "volume": n} for n in range(count)]


@pytest.mark.skipif(os.name != "nt", reason="Windows extended-length backup path regression")
def test_backup_long_windows_destination_preserves_manifest_paths(tmp_path):
    root = tmp_path / "source"
    source = root / ("r" * 50) / ("d" * 64 + ".json")
    source.parent.mkdir(parents=True)
    source.write_bytes(b"immutable fixture")
    dump = tmp_path / "metadata.dump"; dump.write_bytes(b"fixture dump")
    backup = tmp_path / ("b" * 60) / ("n" * 50)
    create_backup_bundle(root, dump, backup, artifact_references={source.relative_to(root).as_posix(): sha256_file(source)},
                         snapshot_id="long-path-fixture", mutations_quiesced=True)
    manifest = verify_backup_bundle(backup)
    assert len(str(backup / manifest['files'][1]['path'])) > 260
    assert all(not entry['path'].startswith('\\\\?\\') for entry in manifest['files'])


def test_range_prunes_row_groups_projects_and_keeps_cutoff(tmp_path):
    store = ArtifactStore(tmp_path)
    relative, checksum = store.write_dataset_iter("w", "d", rows(), batch_size=10)
    original = pq.ParquetFile.iter_batches
    scans = []

    def observe(parquet, *args, **kwargs):
        scans.append(kwargs)
        return original(parquet, *args, **kwargs)

    with patch.object(pq.ParquetFile, "iter_batches", observe):
        result = store.read_dataset_range(relative, checksum, from_utc=24, to_utc=36, max_bars=12)
    assert [row["timestamp"] for row in result] == list(range(24, 36))
    assert scans[0]["row_groups"] == [2, 3]
    assert scans[0]["columns"] == ["timestamp", "open", "high", "low", "close"]
    assert "volume" not in result[0]
    with pytest.raises(ValueError, match="budget.max_bars"):
        store.read_dataset_range(relative, checksum, from_utc=24, to_utc=36, max_bars=11)


def test_corruption_outside_range_still_rejected(tmp_path):
    store = ArtifactStore(tmp_path)
    relative, checksum = store.write_dataset("w", "d", rows())
    path = tmp_path / relative
    data = bytearray(path.read_bytes())
    data[20] ^= 1
    path.write_bytes(data)
    with pytest.raises(ArtifactConflict, match="checksum"):
        store.read_dataset_range(relative, checksum, from_utc=99, to_utc=100, max_bars=1)


def test_mutation_during_read_invalidates_identity(tmp_path):
    store = ArtifactStore(tmp_path)
    relative, checksum = store.write_dataset("w", "d", rows())
    path = tmp_path / relative
    original = pq.ParquetFile.iter_batches

    def mutate(parquet, *args, **kwargs):
        for batch in original(parquet, *args, **kwargs):
            value = path.stat()
            os.utime(path, ns=(value.st_atime_ns, value.st_mtime_ns + 1_000_000))
            yield batch

    with patch.object(pq.ParquetFile, "iter_batches", mutate), pytest.raises(ArtifactConflict, match="changed"):
        store.read_dataset_range(relative, checksum, from_utc=0, to_utc=10, max_bars=10)


def test_concurrent_publication_has_one_winner_and_no_temp(tmp_path):
    store = ArtifactStore(tmp_path)
    barrier = Barrier(2)

    def write(value):
        def stream():
            barrier.wait(timeout=10)
            yield {**rows(1)[0], "close": value}
        try:
            return store.write_dataset_iter("w", "d", stream())
        except ArtifactConflict:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(write, [10.0, 20.0]))
    winners = [outcome for outcome in outcomes if outcome]
    assert len(winners) == 1
    relative, checksum = winners[0]
    assert store.read_dataset(relative, checksum)[0]["close"] in (10.0, 20.0)
    assert not list(tmp_path.rglob("*.tmp"))


def test_failed_publication_does_not_claim_success_or_leave_temp(tmp_path):
    store = ArtifactStore(tmp_path)
    with patch("trading_workspace_v2.artifacts.publish_immutable", side_effect=OSError("disk failure")):
        with pytest.raises(OSError):
            store.write_result("w", "j", {"ok": True})
    assert not (tmp_path / "w/results/j.json").exists()
    assert not list(tmp_path.rglob("*.tmp"))


def test_concurrent_quarantine_is_idempotent(tmp_path):
    store = ArtifactStore(tmp_path)
    for attempt in range(30):
        path, _ = store.write_result_candidate("w", "job", attempt, "lease", {"ok": True})
        barrier = Barrier(2)
        def quarantine(_):
            barrier.wait(timeout=10)
            return store.quarantine_result_candidate(path)
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(quarantine, [0, 1]))
        assert outcomes[0] == outcomes[1]
        assert (tmp_path / outcomes[0]).is_file()


def test_symlink_directory_and_reserved_names_rejected(tmp_path):
    store = ArtifactStore(tmp_path / "artifacts")
    outside = tmp_path / "outside"
    outside.mkdir()
    with pytest.raises(ValueError):
        store.write_dataset("NUL", "d", rows(1))
    link = store.root / "w"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation requires Windows privilege")
    with pytest.raises(ValueError):
        store.write_dataset("w", "d", rows(1))
    assert not list(outside.iterdir())


def bundle(tmp_path):
    store = ArtifactStore(tmp_path / "source")
    relative, checksum = store.write_dataset("w", "d", rows(2))
    dump = tmp_path / "database.dump"
    dump.write_bytes(b"synthetic PostgreSQL dump; no real database touched")
    destination = tmp_path / "backup"
    manifest = create_backup_bundle(store.root, dump, destination, artifact_references={relative: checksum}, snapshot_id="fixture-1", mutations_quiesced=True)
    return destination, manifest


def test_checked_backup_restore_and_corruption(tmp_path):
    destination, manifest = bundle(tmp_path)
    assert verify_backup_bundle(destination) == manifest
    restored = tmp_path / "restored"
    dump = restore_backup_files(destination, restored)
    assert sha256_file(dump) == manifest["files"][0]["sha256"]
    dataset = restored / manifest["files"][1]["path"]
    assert sha256_file(dataset) == manifest["files"][1]["sha256"]
    with pytest.raises(FileExistsError):
        restore_backup_files(destination, restored)
    (destination / manifest["files"][1]["path"]).write_bytes(b"changed")
    with pytest.raises(ArtifactConflict):
        restore_backup_files(destination, tmp_path / "bad")
    assert not (tmp_path / "bad").exists()


def test_backup_requires_quiescence(tmp_path):
    with pytest.raises(ValueError, match="quiesced"):
        create_backup_bundle(tmp_path, tmp_path / "missing", tmp_path / "backup", artifact_references={}, snapshot_id="fixture", mutations_quiesced=False)
    assert not (tmp_path / "backup").exists()


class MemoryS3:
    def __init__(self):
        self.objects = {}
        self.calls = []
        self.fail_suffix = None

    def put_object(self, **kwargs):
        assert kwargs["IfNoneMatch"] == "*"
        self.calls.append(kwargs["Key"])
        if self.fail_suffix and kwargs["Key"].endswith(self.fail_suffix):
            raise OSError("upload failure")
        key = (kwargs["Bucket"], kwargs["Key"])
        assert key not in self.objects
        self.objects[key] = kwargs["Body"]

    def get_object(self, **kwargs):
        data = self.objects[(kwargs["Bucket"], kwargs["Key"])]
        return {"Body": io.BytesIO(data), "ContentLength": len(data)}


def test_s3_backup_roundtrip_commits_manifest_last(tmp_path):
    local, manifest = bundle(tmp_path)
    client = MemoryS3()
    repository = S3BackupRepository(client, "private-fixture")
    reference = repository.upload_bundle(local)
    assert client.calls[-1].endswith("/manifest.json")
    downloaded = tmp_path / "downloaded"
    assert repository.download_bundle(reference, downloaded) == manifest
    assert verify_backup_bundle(downloaded) == manifest
    key = next(key for key in client.objects if key[1].endswith("metadata.dump"))
    client.objects[key] = b"corrupt"
    with pytest.raises(ArtifactConflict):
        repository.download_bundle(reference, tmp_path / "corrupt")
    assert not (tmp_path / "corrupt/bundle/results/manifest.json").exists()


def test_s3_failed_upload_never_publishes_manifest(tmp_path):
    local, _ = bundle(tmp_path)
    client = MemoryS3()
    client.fail_suffix = ".parquet"
    with pytest.raises(OSError):
        S3BackupRepository(client, "fixture").upload_bundle(local)
    assert not any(key[1].endswith("manifest.json") for key in client.objects)


def test_s3_preflight_size_and_restore_total_budget(tmp_path):
    local, _ = bundle(tmp_path)
    client = MemoryS3()
    with pytest.raises(ValueError, match="budget"):
        S3BackupRepository(client, "fixture", max_object_bytes=1).upload_bundle(local)
    assert not client.calls
    repository = S3BackupRepository(client, "fixture")
    reference = repository.upload_bundle(local)
    with pytest.raises(ValueError, match="budget"):
        repository.download_bundle(reference, tmp_path / "oversized", max_bytes=1)
    assert not (tmp_path / "oversized").exists()


def test_ingest_publishes_manifest_on_guard_connection(tmp_path):
    connection = object()
    class Store:
        manifest = None
        received_connection = None
        def ensure_workspace(self, _):
            pass
        def get_dataset(self, *_):
            return self.manifest
        def put_dataset(self, manifest, *, conn=None):
            self.received_connection = conn
            self.manifest = manifest
    @contextmanager
    def guard():
        yield connection
    source = {"source_id": "fixture", "provider": "synthetic", "instrument_mapping": {"EURUSD": "EURUSD"}, "license_use": "qa-only", "retrieved_at_utc": "2026-01-01T00:00:00Z", "export_settings": "fixture"}
    csv = tmp_path / "source.csv"
    csv.write_text("time,open,high,low,close,volume\n60,1,2,1,1,0\n120,1,2,1,1,1\n")
    store = Store()
    manifest = DataIngestService(store, ArtifactStore(tmp_path / "artifacts")).import_csv(
        workspace_id="w", path=csv, source=source, instrument="EURUSD", timeframe_seconds=60, publication_guard=guard(),
    )
    assert store.received_connection is connection
    assert store.manifest is manifest
