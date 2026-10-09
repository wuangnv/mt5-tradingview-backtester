from bisect import bisect_right
from pathlib import Path
import sys
from unittest.mock import patch

import pytest

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]

from trading_workspace_v2.artifacts import ArtifactConflict, ArtifactStore
from trading_workspace_v2.replay import ReplayService
from foundation_v2.tests.test_replay_portfolio import PortfolioStore, BASE_TIME


@pytest.mark.parametrize('start', [0, 3, 5])
def test_native_portfolio_create_preserves_clock_without_full_history(tmp_path, start):
    store = PortfolioStore()
    baseline = ReplayService(store, store).create('tenant-a', 'a', start_index=start,
                                                dataset_ids=['a', 'b'], starting_balance='100000')
    artifacts = ArtifactStore(tmp_path)
    for key, manifest in store.manifests.items():
        manifest.artifact_path, manifest.artifact_sha256 = artifacts.write_dataset('tenant-a', key, store.bars[key])
    with patch.object(artifacts, 'read_dataset', side_effect=AssertionError('full history forbidden')):
        candidate = ReplayService(store, artifacts).create('tenant-a', 'a', start_index=start,
                                                        dataset_ids=['a', 'b'], starting_balance='100000')
    for key in ['dataset_ids', 'asset_states', 'cursor_index', 'replay_clock_utc', 'replay_start_utc',
                'replay_end_utc', 'starting_balance', 'starting_balance_ccy']:
        assert candidate['payload'][key] == baseline['payload'][key]
    assert candidate['visible_rows'] == baseline['visible_rows']
    assert candidate['portfolio_account'] == baseline['portfolio_account']


def test_timing_search_matches_market_gaps_and_group_boundaries(tmp_path):
    artifacts = ArtifactStore(tmp_path)
    timestamps = [BASE_TIME + n * 60 + (3600 if n >= 5000 else 0) for n in range(20000)]
    rows = [dict(timestamp=t, open=1., high=2., low=.5, close=1.2) for t in timestamps]
    path, digest = artifacts.write_dataset_iter('w', 'data', rows, batch_size=1000)
    with patch.object(artifacts, 'read_dataset', side_effect=AssertionError('full history forbidden')):
        for cutoff in [timestamps[0] - 1, timestamps[0], timestamps[4999] + 30,
                       timestamps[5000], timestamps[10000], timestamps[-1] + 60]:
            timing = artifacts.read_dataset_replay_timing(path, digest, index=10000, at_or_before=cutoff)
            assert timing == {'row_count': len(rows), 'first_utc': timestamps[0], 'last_utc': timestamps[-1],
                              'index_utc': timestamps[10000], 'cursor_index': bisect_right(timestamps, cutoff) - 1}
    for index in [-1, len(rows), True]:
        with pytest.raises(ValueError):
            artifacts.read_dataset_replay_timing(path, digest, index=index)
    with pytest.raises(ArtifactConflict):
        artifacts.read_dataset_replay_timing(path, '0' * 64)


def test_creation_rejects_manifest_row_count_drift_before_persist(tmp_path):
    store, artifacts = PortfolioStore(), ArtifactStore(tmp_path)
    manifest = store.manifests['a']
    manifest.artifact_path, manifest.artifact_sha256 = artifacts.write_dataset('tenant-a', 'a', store.bars['a'])
    manifest.row_count += 1
    with patch.object(store, 'create_record', wraps=store.create_record) as persist:
        with pytest.raises(RuntimeError, match='row count'):
            ReplayService(store, artifacts).create('tenant-a', 'a')
        persist.assert_not_called()
