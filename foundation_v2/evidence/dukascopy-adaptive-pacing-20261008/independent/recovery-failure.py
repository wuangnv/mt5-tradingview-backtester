import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

foundation = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(foundation), str(foundation / 'tests')]
from test_dukascopy_full_downloads import FullDownloadTests

case = FullDownloadTests()
case.setUp()
try:
    service = case.service
    service.node, service.worker = 'mock-node', Path('mock-worker')
    job = service.request_full('a', 'EUR/USD')
    class Output:
        def __iter__(self):
            yield json.dumps({'event': 'complete', 'buckets_sha256': 'mock-hash'})
        def close(self):
            pass
    process = SimpleNamespace(stdout=Output(), terminate=lambda: None, poll=lambda: 0, wait=lambda **kwargs: 0)
    publication_calls = []
    def complete(completed_job, folder):
        publication_calls.append(True)
        completed_job.update(status='completed', dataset_id='already-published', error=None)
        service._save(completed_job)
    service._complete = complete
    with patch('trading_workspace_v2.dukascopy_downloads.subprocess.Popen', return_value=process), patch.object(service, '_record_source_success', side_effect=OSError('mock policy disk failure')):
        service._run(service._read('a', job['job_id']))
    observed = service._read('a', job['job_id'])
    result = {'scope': 'Isolated temporary mock; no provider/runtime/real job writes', 'status': observed['status'], 'dataset_id': observed['dataset_id'], 'error': observed['error'], 'publication_calls': len(publication_calls), 'pass': observed['status'] == 'paused' and observed['dataset_id'] is None and not publication_calls}
    Path(__file__).with_name('recovery-failure-results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
finally:
    case.doCleanups()
