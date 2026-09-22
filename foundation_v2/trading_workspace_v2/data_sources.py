from __future__ import annotations

from collections.abc import Mapping

from .store import PostgresStore


DEFAULT_CAPABILITIES = {
    "read_metadata": True,
    "read_history": False,
    "import": False,
    "news": False,
    "fresh_quote": False,
    "holdout_content": False,
}


class DataProviderRegistry:
    def __init__(self, providers):
        self._providers = {}
        for provider in providers:
            provider_id = str(provider.provider_id)
            if provider_id in self._providers:
                raise ValueError(f"duplicate data provider: {provider_id}")
            self._providers[provider_id] = provider

    def capabilities(self) -> list[dict]:
        return [
            {
                "provider_id": provider_id,
                "capabilities": dict(provider.capabilities),
            }
            for provider_id, provider in sorted(self._providers.items())
        ]

    def list_datasets(self, workspace_id: str) -> list[dict]:
        datasets = []
        for provider_id, provider in sorted(self._providers.items()):
            for item in provider.list_datasets(workspace_id):
                normalized = dict(item)
                normalized["provider_id"] = provider_id
                datasets.append(normalized)
        return datasets


class LocalCatalogProvider:
    provider_id = "local-catalog"
    capabilities = dict(DEFAULT_CAPABILITIES)

    def __init__(self, store: PostgresStore):
        self.store = store

    def list_datasets(self, workspace_id: str) -> list[dict]:
        items = []
        for manifest in self.store.list_datasets(workspace_id):
            items.append(
                {
                    **manifest.model_dump(mode="json"),
                    "quality_status": "fixture-only" if manifest.source.license_use == "qa-only" else "unverified",
                    "holdout_access": False,
                }
            )
        return items


class StaticMetadataProvider:
    """Offline provider used to verify connector replacement without network access."""

    def __init__(self, provider_id: str, datasets_by_workspace: Mapping[str, list[dict]], capabilities=None):
        self.provider_id = str(provider_id)
        self._datasets = {
            str(workspace_id): [dict(item) for item in items]
            for workspace_id, items in datasets_by_workspace.items()
        }
        self.capabilities = {
            **DEFAULT_CAPABILITIES,
            **dict(capabilities or {}),
        }

    def list_datasets(self, workspace_id: str) -> list[dict]:
        return [dict(item) for item in self._datasets.get(str(workspace_id), [])]
