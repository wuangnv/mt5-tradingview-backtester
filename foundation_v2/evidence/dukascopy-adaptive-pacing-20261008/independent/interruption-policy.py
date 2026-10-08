import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

foundation = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(foundation), str(foundation / 'tests')]
from test_dukascopy_full_downloads import FullDownloadTests

results = []
for action in ('pause', 'cancel'):
    case = FullDownloadTests()
    case.setUp()
    try:
        service = case.service
        service.node, service.worker = 'mock-node', Path('mock-worker')
        job = service.request_full('a', 'EUR/USD')
        class Output:
            def __iter__(self):
                getattr(service, action)('a', job['job_id'])
                yield json.dumps({'event': 'error', 'error': 'source_rate_limited', 'retry_after_seconds': 900})
            def close(self):
                pass
        process = SimpleNamespace(stdout=Output(), terminate=lambda: None, poll=lambda: 1, wait=lambda **kwargs: 1)
        with patch('trading_workspace_v2.dukascopy_downloads.subprocess.Popen', return_value=process), patch('trading_workspace_v2.dukascopy_downloads.time.time', return_value=10000):
            service._run(service._read('a', job['job_id']))
        policy = service._source_policy()
        observed = service._read('a', job['job_id'])
        expected = 'paused' if action == 'pause' else 'cancelled'
        passed = observed['status'] == expected and policy == {'until': 10900, 'rate_limit_level': 1}
        assert passed
        results.append({'action': action, 'status': observed['status'], 'policy': policy, 'pass': passed})
    finally:
        case.doCleanups()
Path(__file__).with_name('interruption-policy-results.json').write_text(json.dumps({'pass': True, 'scope': 'Isolated mocks only', 'cases': results}, indent=2), encoding='utf-8')
print(json.dumps(results))
