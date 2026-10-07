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

# This is deliberately a separate contract from ``capabilities``.  A provider
# may expose metadata while still being unsuitable for a production run (for
# example a local fixture or a dataset whose license has not been verified).
# Keep the defaults fail-closed so adding a provider cannot accidentally make
# network, OAuth, or entitlement authority appear available.
DEFAULT_READINESS = {
    "source_kind": "unknown",
    "connection_mode": "offline",
    "network_access": False,
    "oauth_required": False,
    "entitlement_status": "unverified",
    "production_ready": False,
}


def _provider_readiness(provider) -> dict:
    """Return a bounded, non-secret readiness profile for one provider.

    The profile is descriptive only.  It never contains credentials, URLs, or
    account identifiers and it does not grant access to a provider.  Unknown
    provider implementations inherit fail-closed defaults until they declare a
    reviewed profile explicitly.
    """

    declared = getattr(provider, "readiness", {})
    if not isinstance(declared, Mapping):
        declared = {}
    declared = dict(declared)
    profile = {
        key: declared.get(key, default)
        for key, default in DEFAULT_READINESS.items()
    }
    profile["source_kind"] = str(profile["source_kind"])
    profile["connection_mode"] = str(profile["connection_mode"])
    profile["network_access"] = bool(profile["network_access"])
    profile["oauth_required"] = bool(profile["oauth_required"])
    profile["entitlement_status"] = str(profile["entitlement_status"])
    # Production readiness is never inferred from capabilities or from a
    # provider name.  A future real connector must opt in through a separately
    # reviewed implementation and entitlement check.
    profile["production_ready"] = bool(profile["production_ready"])
    return profile


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
                "readiness": _provider_readiness(provider),
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

    def list_instruments(self, workspace_id: str) -> list[dict]:
        """Only configured providers may declare catalog metadata; no discovery I/O."""
        instruments = []
        for provider_id, provider in sorted(self._providers.items()):
            listing = getattr(provider, "list_instruments", None)
            if not callable(listing) or not provider.capabilities.get("read_metadata", False):
                continue
            for item in listing(workspace_id):
                # Metadata does not grant historical-download authority.
                instruments.append({**dict(item), "provider_id": provider_id})
        return instruments


class LocalCatalogProvider:
    provider_id = "local-catalog"
    capabilities = dict(DEFAULT_CAPABILITIES)
    readiness = {
        "source_kind": "local_catalog",
        "connection_mode": "offline_local",
        "network_access": False,
        "oauth_required": False,
        "entitlement_status": "dataset_metadata_only",
        "production_ready": False,
    }

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

    readiness = {
        "source_kind": "offline_fixture",
        "connection_mode": "offline_fixture",
        "network_access": False,
        "oauth_required": False,
        "entitlement_status": "fixture_only",
        "production_ready": False,
    }

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
