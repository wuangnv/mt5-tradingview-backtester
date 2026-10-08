"""Remove only unpinned local dataset versions; public catalogs are untouched."""
from __future__ import annotations

import hashlib
import json

from .market_sync import atomic_json


class DatasetInUse(RuntimeError):
    pass


class LocalDatasetService:
    def __init__(self, store, artifacts):
        self.store, self.artifacts = store, artifacts

    def _journal(self, workspace, dataset_id):
        digest = hashlib.sha256(f'{workspace}:{dataset_id}'.encode()).hexdigest()
        return self.artifacts.root / 'dataset-removals' / f'{digest}.json'

    def delete_dataset(self, workspace, dataset_id):
        with self.store.dataset_mutation(workspace, dataset_id):
            return self._delete_dataset(workspace, dataset_id)

    def _delete_dataset(self, workspace, dataset_id):
        journal = self._journal(workspace, dataset_id)
        paths = None
        # Hold the row lock through commit. Files remain available until all pins
        # have been checked and the catalog transaction has durably removed it.
        with self.store.dataset_removal(workspace, dataset_id) as manifest:
            if manifest is not None:
                paths = self.artifacts.dataset_paths(workspace, dataset_id, manifest.artifact_path, manifest.raw_artifact_path)
                journal.parent.mkdir(parents=True, exist_ok=True)
                atomic_json(journal, {'workspace_id': workspace, 'dataset_id': dataset_id,
                                      'artifact_path': manifest.artifact_path, 'raw_artifact_path': manifest.raw_artifact_path})
            elif journal.is_file():
                saved = json.loads(journal.read_text(encoding='utf-8'))
                if saved.get('workspace_id') != workspace or saved.get('dataset_id') != dataset_id:
                    raise ValueError('invalid_dataset_artifact_path')
                paths = self.artifacts.dataset_paths(workspace, dataset_id, saved['artifact_path'], saved.get('raw_artifact_path'))
            else:
                raise LookupError('dataset_not_found')
        # A crash or sharing violation leaves the exact-path journal for retry.
        # No directory tree, session, provider catalog or other version is removed.
        for path in paths:
            path.unlink(missing_ok=True)
        journal.unlink(missing_ok=True)
        return {'dataset_id': dataset_id, 'deleted': True}
