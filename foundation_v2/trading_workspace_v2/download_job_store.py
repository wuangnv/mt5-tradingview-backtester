"""Durable download authority; raw files are restart checkpoints, not API state."""
from __future__ import annotations

import json
from contextlib import nullcontext

PUBLIC_JOB_FIELDS = frozenset({
    'job_id','instrument_id','from_date','to_date','status','error','completed_days','total_days',
    'dataset_id','transferred_bytes','cached_bytes','stage','full_from_date','parent_dataset_id',
    'created_at_utc','revision','provider_code','catalog_sha256','network_days','buckets_sha256',
    'quality','provider','supports_pause','supports_cancel','data_source','download_engine',
    'progress_scope','progress_percent','qdm_version','qdm_retrieved_at_utc','qdm_export_sha256',
})


def public_download_snapshot(job):
    # Unknown additions stay private until consciously promoted to the wire contract.
    result = {key: value for key, value in job.items() if key in PUBLIC_JOB_FIELDS}
    if any(isinstance(value, (dict,list)) for value in result.values()):
        raise ValueError('invalid_download_snapshot')
    return result


class DownloadRevisionConflict(RuntimeError):
    def __init__(self):
        super().__init__('download_revision_conflict')


class DownloadJobStore:
    def __init__(self, store, provider):
        self.store, self.provider = store, provider

    def source(self, snapshot):
        with self.store.connect() as conn:
            conn.execute('''INSERT INTO download_sources(provider,snapshot) VALUES(%s,%s::jsonb)
                ON CONFLICT(provider) DO UPDATE SET snapshot=EXCLUDED.snapshot,
                revision=download_sources.revision+1,updated_at_utc=CURRENT_TIMESTAMP
                WHERE download_sources.snapshot IS DISTINCT FROM EXCLUDED.snapshot''',
                (self.provider, json.dumps(snapshot)))

    def read(self, workspace, job_id):
        with self.store.connect() as conn:
            row = conn.execute('''SELECT payload,revision FROM download_jobs
                WHERE workspace_id=%s AND provider=%s AND job_id=%s''',
                (workspace, self.provider, job_id)).fetchone()
        if row is None:
            raise ValueError('download_not_found')
        return {**row['payload'], 'revision': row['revision']}

    def list(self, workspace, limit=20):
        with self.store.connect() as conn:
            rows = conn.execute('''SELECT snapshot FROM download_job_snapshots
                WHERE workspace_id=%s AND provider=%s
                ORDER BY created_at_utc DESC,job_id DESC LIMIT %s''',
                (workspace, self.provider, limit)).fetchall()
        return [row['snapshot'] for row in rows]

    def matching(self, workspace, symbol, start, end, parent, full_start):
        with self.store.connect() as conn:
            rows = conn.execute('''SELECT snapshot FROM download_job_snapshots
                WHERE workspace_id=%s AND provider=%s
                AND snapshot->>'instrument_id'=%s AND snapshot->>'from_date'=%s
                AND snapshot->>'to_date'=%s
                AND snapshot->>'parent_dataset_id' IS NOT DISTINCT FROM %s
                AND snapshot->>'full_from_date' IS NOT DISTINCT FROM %s
                AND snapshot->>'status' NOT IN ('cancelled','failed')
                ORDER BY created_at_utc DESC,job_id DESC''',
                (workspace,self.provider,symbol,start,end,parent,full_start)).fetchall()
        return [row['snapshot'] for row in rows]

    def save(self, job, snapshot, owner_lock_key, *, adopt=False, conn=None):
        snapshot = public_download_snapshot(snapshot)
        payload = {key: value for key, value in job.items() if key != 'revision'}
        args = (json.dumps(payload), json.dumps(snapshot), owner_lock_key,
                job['workspace_id'], self.provider, job['job_id'])
        with self.store.connect() if conn is None else nullcontext(conn) as conn:
            if job.get('revision') is not None and not adopt:
                row = conn.execute('''UPDATE download_jobs SET payload=%s::jsonb,
                    public_snapshot=%s::jsonb,owner_lock_key=%s,revision=revision+1,
                    updated_at_utc=CURRENT_TIMESTAMP
                    WHERE workspace_id=%s AND provider=%s AND job_id=%s AND revision=%s
                    RETURNING revision''', (*args, job['revision'])).fetchone()
                if row is None:
                    raise DownloadRevisionConflict()
            else:
                row = conn.execute('''INSERT INTO download_jobs(payload,public_snapshot,owner_lock_key,
                    workspace_id,provider,job_id,created_at_utc)
                    VALUES(%s::jsonb,%s::jsonb,%s,%s,%s,%s,%s)
                    ON CONFLICT(workspace_id,provider,job_id) DO NOTHING RETURNING revision''',
                    (*args, job['created_at_utc'])).fetchone()
                if row is None:
                    if not adopt:
                        raise DownloadRevisionConflict()
                    return False
            job['revision'] = row['revision']
        return True
