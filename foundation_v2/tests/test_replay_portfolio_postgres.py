import os
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
import pytest

from foundation_v2.scripts.serve_portfolio_qa import portfolio_qa_app
from foundation_v2.tests.test_ps02_replay_prop_connection import cost_mapping


@pytest.fixture(scope='module')
def api():
    if not os.environ.get('TW_V2_DATABASE_URL'):
        pytest.skip('requires local PostgreSQL credentials; fixture creates its own database')
    with portfolio_qa_app() as (app, datasets), TestClient(app) as client:
        yield client, app.state.store, datasets


def test_api_create_switch_revision_race_reload_and_dataset_references(api):
    client, store, datasets = api
    headers = {'X-Workspace-Id':'tenant-a'}
    ids = [dataset.dataset_id for dataset in datasets]
    created = client.post('/api/v2/replay/sessions', headers=headers, json={
        'dataset_id':ids[0], 'dataset_ids':ids, 'name':'QA shared portfolio', 'starting_balance':'100000'})
    assert created.status_code == 201, created.text
    record = created.json()
    path = '/api/v2/replay/sessions/' + record['record_id']
    assert record['portfolio_account']['balance'] == '100000'
    assert record['payload']['dataset_ids'] == ids
    response = client.post(path + '/execution', headers=headers, json={'expected_revision':record['revision'],
        'instrument_spec':datasets[0].instrument_spec, 'cost_model':cost_mapping(), 'spread_price':'.0002',
        'timeframe_seconds':60, 'starting_balance':'100000'})
    assert response.status_code == 200, response.text
    record = response.json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _:client.post(path + '/asset', headers=headers,
            json={'expected_revision':record['revision'], 'dataset_id':ids[1]}), range(2)))
    assert sorted(response.status_code for response in responses) == [200,409]
    switched = client.get(path, headers=headers).json()
    assert switched['payload']['dataset_id'] == ids[1]
    assert switched['payload']['asset_states'][ids[0]]['execution'] is not None
    assert switched['portfolio_account'] == record['portfolio_account']
    assert client.post(path + '/asset', headers={'X-Workspace-Id':'tenant-other'},
        json={'expected_revision':switched['revision'],'dataset_id':ids[0]}).status_code == 404
    assert client.post(path + '/asset', headers=headers,
        json={'expected_revision':switched['revision'],'dataset_id':'not-a-member'}).status_code == 422
    analytics = client.get(path + '/analytics', headers=headers)
    assert analytics.status_code == 200, analytics.text
    assert analytics.json()['dataset_ids'] == ids
    for dataset in datasets:
        with pytest.raises(RuntimeError, match='dataset_in_use'):
            with store.dataset_removal('tenant-a', dataset.dataset_id):
                pass
    catalog = client.get('/api/v2/replay/sessions', headers=headers).json()['items']
    item = next(item for item in catalog if item['record_id'] == record['record_id'])
    assert item['instrument_ids'] == ['EURUSD','GBPUSD']
    assert item['has_execution'] is True
    with store.connect() as connection, pytest.raises(ValueError, match='Prop lifecycle'):
        store._lock_resume_replay(connection, 'tenant-a', {'replay_binding':{'replay_session_id':record['record_id']}})
    # Exercise the lock recheck repeatedly; an outdated revision must never become a false 404.
    for index in range(6):
        current = client.get(path, headers=headers).json()
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _:client.post(path + '/asset', headers=headers,
                json={'expected_revision':current['revision'], 'dataset_id':ids[index % 2]}), range(2)))
        assert sorted(response.status_code for response in responses) == [200,409]
