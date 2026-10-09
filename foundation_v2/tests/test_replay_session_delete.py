import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

for path in (Path(__file__).resolve().parents[1], Path(__file__).resolve().parents[2]):
    sys.path.insert(0, str(path))

from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.contracts import ReplayDelete
from trading_workspace_v2.store import PostgresStore
from foundation_v2.tests.test_ps03_prop_reports import fixture as prop_fixture


@pytest.fixture
def api():
    dsn = os.getenv('TW_V2_DATABASE_URL')
    if not dsn:
        pytest.skip('requires disposable Postgres')
    workspace = 'delete-' + uuid4().hex
    # Short artifact roots keep immutable dataset paths below Windows MAX_PATH.
    with TemporaryDirectory(prefix='tw-delete-') as folder:
        app = create_app(dsn=dsn, artifact_root=folder, learn_roots={},
                         authorization=LocalWorkspaceAuthorization.for_local_owner([workspace, workspace + '-other']))
        csv = Path(folder) / 'shared.csv'
        csv.write_text('time,open,high,low,close,volume\n60,1,2,1,1,0\n120,1,2,1,1,1\n')
        app.state.ingest.import_csv(workspace_id=workspace, path=csv,
            source={'source_id':'delete-test', 'provider':'Synthetic QA', 'license_use':'qa-only',
                    'instrument_mapping':{'EUR-USD':'EUR/USD'}, 'retrieved_at_utc':'2026-01-01T00:00:00Z',
                    'export_settings':'synthetic deletion fixture'}, instrument='EUR/USD', timeframe_seconds=60)
        with TestClient(app) as client:
            yield client, app.state.store, workspace


def create(store, workspace, **changes):
    store.ensure_workspace(workspace)
    return store.create_record(workspace, 'replay', {
        'name': 'London session', 'dataset_id': store.list_datasets(workspace)[0].dataset_id, 'cursor_index': 0,
        'branch_id': 'root', 'status': 'paused', **changes,
    })


@pytest.mark.parametrize('revision', [True, False, '1', 1.0, 0, -1, None])
def test_strict_revision(revision):
    with pytest.raises(ValueError):
        ReplayDelete(expected_revision=revision, confirmation_name='London session')


@pytest.mark.parametrize('archived', [False, True])
def test_delete_hides_canonical_reads_preserves_immutable_evidence_and_other_records(api, archived):
    client, store, workspace = api
    record = create(store, workspace, archived=archived)
    child = create(store, workspace, parent_session_id=record['record_id'], parent_revision=1)
    note = store.create_record(workspace, 'journal', {'note': 'independent evidence'})
    annotation = store.create_record(workspace, 'annotation', {'run_id': record['record_id']})
    headers = {'X-Workspace-Id': workspace}
    route = '/api/v2/replay/sessions/' + record['record_id']
    deleted = client.post(route + '/delete', headers=headers,
                          json={'expected_revision': 1, 'confirmation_name': 'London session'})
    assert deleted.status_code == 200
    assert deleted.json() == {'record_id': record['record_id'], 'revision': 2, 'deleted': True}
    assert store.get_record(workspace, 'replay', record['record_id']) is None
    versions = store.list_record_revisions(workspace, 'replay', record['record_id'])
    assert [(v['revision'], v['deleted']) for v in versions] == [(1, False), (2, True)]
    assert versions[0]['payload'] == versions[1]['payload'] == record['payload']
    assert [v['record_id'] for v in client.get('/api/v2/replay/sessions', headers=headers).json()['items']] == [child['record_id']]
    for suffix in ('', '/analytics', '/analytics/experiments'):
        assert client.get(route + suffix, headers=headers).status_code == 404
    for suffix, body in [('/delete', {'expected_revision': 2, 'confirmation_name': 'London session'}),
                         ('/step', {'expected_revision': 2, 'steps': 1}),
                         ('/branch', {'expected_revision': 2, 'cursor_index': 0})]:
        assert client.post(route + suffix, headers=headers, json=body).status_code == 404
    assert client.patch(route, headers=headers, json={'expected_revision': 2, 'archived': False}).status_code == 404
    assert store.get_record(workspace, 'replay', child['record_id']) == child
    assert store.get_record(workspace, 'journal', note['record_id']) == note
    assert store.get_record(workspace, 'annotation', annotation['record_id']) == annotation


def test_scoped_delete_validation_leaves_record_unchanged(api):
    client, store, workspace = api
    record = create(store, workspace)
    route = '/api/v2/replay/sessions/' + record['record_id'] + '/delete'
    cases = [(workspace + '-other', {'expected_revision': 1, 'confirmation_name': 'London session'}, 404),
             (workspace, {'expected_revision': 2, 'confirmation_name': 'London session'}, 409),
             (workspace, {'expected_revision': 1, 'confirmation_name': 'London'}, 422),
             (workspace, {'expected_revision': True, 'confirmation_name': 'London session'}, 422),
             (workspace, {'expected_revision': 1, 'confirmation_name': 'London session', 'force': True}, 422)]
    for scope, body, status in cases:
        assert client.post(route, headers={'X-Workspace-Id': scope}, json=body).status_code == status
        assert store.get_record(workspace, 'replay', record['record_id']) == record


def prop_context(workspace):
    session, attempt, phase, resume = prop_fixture()
    session = session.model_copy(update={'workspace_id': workspace, 'revision': 1})
    attempt = attempt.model_copy(update={'workspace_id': workspace, 'revision': 1})
    phase = phase.model_copy(update={'workspace_id': workspace})
    return session, attempt, phase, resume


def test_prop_dependency_blocks_delete_and_deleted_replay_cannot_gain_binding(api):
    _, store, workspace = api
    replay = create(store, workspace)
    session, attempt, phase, resume = prop_context(workspace)
    resume['replay_binding'] = {'replay_session_id': replay['record_id']}
    store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)
    with pytest.raises(RuntimeError, match='replay_linked_to_prop_attempt'):
        store.delete_replay_session(workspace, replay['record_id'], 1, 'London session')
    assert store.get_record(workspace, 'replay', replay['record_id']) == replay
    another = create(store, workspace)
    store.delete_replay_session(workspace, another['record_id'], 1, 'London session')
    resume['replay_binding'] = {'replay_session_id': another['record_id']}
    for write in (
        lambda: store.create_prop_session_bundle(session, attempt, phase, resume_state=resume),
        lambda: store.create_prop_attempt(attempt, phase, resume_state=resume),
        lambda: store.save_prop_resume_state(attempt.model_copy(update={'revision': 2}), phase,
                    expected_revision=1, operation_id='deleted-binding', resume_state=resume),
    ):
        with pytest.raises(LookupError, match='replay session not found'):
            write()


def test_delete_and_edit_have_one_winner(api):
    _, store, workspace = api
    replay = create(store, workspace)
    def mutate(deleting):
        writer = PostgresStore(os.environ['TW_V2_DATABASE_URL'])
        try:
            if deleting:
                return writer.delete_replay_session(workspace, replay['record_id'], 1, 'London session')
            return writer.update_record(workspace, 'replay', replay['record_id'], 1, {**replay['payload'], 'name': 'Edited'})
        except (RuntimeError, LookupError, ValueError):
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(mutate, [False, True]))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert len(store.list_record_revisions(workspace, 'replay', replay['record_id'])) == 2


def test_delete_and_first_prop_binding_cannot_both_commit(api):
    _, store, workspace = api
    replay = create(store, workspace)
    session, attempt, phase, resume = prop_context(workspace)
    resume['replay_binding'] = {'replay_session_id': replay['record_id']}
    def mutate(deleting):
        writer = PostgresStore(os.environ['TW_V2_DATABASE_URL'])
        try:
            if deleting:
                return writer.delete_replay_session(workspace, replay['record_id'], 1, 'London session')
            return writer.create_prop_session_bundle(session, attempt, phase, resume_state=resume)
        except (RuntimeError, LookupError):
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(mutate, [False, True]))
    assert sum(isinstance(result, dict) for result in results) == 1
