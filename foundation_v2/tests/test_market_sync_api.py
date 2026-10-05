import tempfile
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization


class MarketSyncApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.headers = {'X-Workspace-Id': 'tenant-a'}

    def tearDown(self):
        self.temp.cleanup()

    def app(self, runtime=None):
        with patch('trading_workspace_v2.api.PostgresStore'):
            return create_app(dsn='unused', artifact_root=self.temp.name,
                authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a']),
                learn_roots={}, market_runtime_factory=(lambda *_: runtime) if runtime else None)

    def test_default_app_never_enables_collector_and_has_explicit_unavailable(self):
        with TestClient(self.app()) as client:
            for route in ('/api/v2/live/status', '/api/v2/data/market-assets'):
                response = client.get(route, headers=self.headers)
                self.assertEqual(response.json()['status'], 'unavailable')
                self.assertFalse(response.json()['execution_capability'])
            self.assertEqual(client.post('/api/v2/data/market-assets/update', headers=self.headers, json={}).status_code, 503)

    def test_scope_request_shape_and_lifespan(self):
        runtime = Mock()
        runtime.catalog.return_value = {'status': 'ready', 'items': []}
        runtime.live_status.return_value = {'status': 'ready', 'execution_capability': False}
        runtime.request.return_value = {'status': 'ready', 'queued': 1}
        with TestClient(self.app(runtime)) as client:
            runtime.start.assert_called_once()
            for route in ('/api/v2/live/status', '/api/v2/data/market-assets'):
                self.assertEqual(client.get(route, headers={'X-Workspace-Id': 'tenant-b'}).status_code, 403)
                self.assertEqual(client.get(route).status_code, 422)
                self.assertEqual(client.get(route, headers=self.headers).status_code, 200)
            self.assertEqual(client.post('/api/v2/data/market-assets/update', headers=self.headers,
                json={'symbol': 'EURUSDm', 'from_date': '2026-07-01'}).status_code, 202)
            runtime.request.assert_called_once_with('tenant-a', 'EURUSDm', '2026-07-01')
            for payload in ({'symbol': '../EURUSDm'}, {'from_date': 'yesterday'}, {'server': 'other'}, {'terminal': 'other'}):
                self.assertEqual(client.post('/api/v2/data/market-assets/update', headers=self.headers, json=payload).status_code, 422)
            self.assertEqual(runtime.request.call_count, 1)
            self.assertEqual(client.post('/api/v2/data/market-assets/update', headers={'X-Workspace-Id': 'tenant-b'}, json={}).status_code, 403)
            self.assertEqual(runtime.request.call_count, 1)
        runtime.stop.assert_called_once()

    def test_non_owner_update_is_503_and_invalid_catalog_symbol_is_422(self):
        runtime = Mock()
        with TestClient(self.app(runtime)) as client:
            for error, expected in ((RuntimeError('market_sync_owner_unavailable'), 503),
                                    (ValueError('unknown_market_asset'), 422),
                                    (PermissionError('market_source_workspace_denied'), 403)):
                runtime.request.side_effect = error
                self.assertEqual(client.post('/api/v2/data/market-assets/update', headers=self.headers, json={}).status_code, expected)


if __name__ == '__main__':
    unittest.main()
