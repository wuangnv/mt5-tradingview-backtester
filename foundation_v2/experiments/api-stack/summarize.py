"""Summarize equivalent diagnostic cases; do not extrapolate to product speed."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import statistics

parser=argparse.ArgumentParser()
parser.add_argument('receipts',nargs='+',type=Path)
args=parser.parse_args()
groups=defaultdict(list)
for path in args.receipts:
    data=json.loads(path.read_text())
    for result in data['results']:
        if result.get('soak_seconds'):continue
        groups[(result['path'],result['connections'],result['framework'])].append(result)

rows=[]
for (path,connections,framework),results in sorted(groups.items()):
    row={'framework':framework,'path':path,'connections':connections,'runs':len(results),
         'median_rps':round(statistics.median(r['rps'] for r in results),2),
         'median_run_p99_ms':statistics.median(r['latency_ms']['p99'] for r in results),
         'peak_server_working_set_MB':max(r['peak_working_set_MB']['server'] for r in results),
         'errors':sum(r['errors']+r['non2xx'] for r in results),
         'generator_peak_sample_cpu_pct':round(max(r['generator_cpu_pct_of_2_cores'] for r in results),2),
         'rps_min':round(min(r['rps'] for r in results),2),'rps_max':round(max(r['rps'] for r in results),2)}
    base=groups.get((path,connections,'fastapi'))
    if base:
        baseline=statistics.median(r['rps'] for r in base)
        row['rps_vs_fastapi']=round(row['median_rps']/baseline,2)
        row['throughput_gain_pct']=round((row['median_rps']/baseline-1)*100,1)
    rows.append(row)
print(json.dumps(rows,indent=2))
