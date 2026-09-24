"""Read-only Data Desk metadata API and replaceable provider boundary."""

from pathlib import Path

from flask import jsonify

from practice_history import PracticeHistoryError, ReadOnlyHistoryReader


class DataAccessDenied(RuntimeError):
    pass


class DataProviderRegistry:
    def __init__(self, providers):
        self.providers = {}
        for provider in providers:
            provider_id = str(provider.provider_id)
            if provider_id in self.providers:
                raise ValueError(f"duplicate data provider: {provider_id}")
            self.providers[provider_id] = provider

    def capabilities(self):
        return [
            {
                "provider_id": provider_id,
                "capabilities": dict(provider.capabilities),
            }
            for provider_id, provider in sorted(self.providers.items())
        ]

    def list_datasets(self):
        datasets = []
        for provider_id, provider in sorted(self.providers.items()):
            for item in provider.list_datasets():
                normalized = dict(item)
                normalized["provider_id"] = provider_id
                datasets.append(normalized)
        return datasets

    def read_through(self, provider_id, symbol, timeframe, decision_time_utc, before_bars=100, holdout_from_utc=None):
        provider_id = str(provider_id)
        provider = self.providers.get(provider_id)
        if provider is None:
            raise KeyError(f"unknown data provider: {provider_id}")
        if not provider.capabilities.get("read_history", False):
            raise DataAccessDenied(f"provider does not allow history reads: {provider_id}")
        return provider.read_through(
            symbol,
            timeframe,
            decision_time_utc,
            before_bars=before_bars,
            holdout_from_utc=holdout_from_utc,
        )


class LocalChunksProvider:
    provider_id = "local-chunks"
    capabilities = {
        "read_metadata": True,
        "read_history": True,
        "import": False,
        "news": False,
        "fresh_quote": False,
        "holdout_content": False,
    }

    def __init__(self, chunks_root):
        self.chunks_root = Path(chunks_root)
        self.reader = ReadOnlyHistoryReader(self.chunks_root)

    def list_datasets(self):
        if not self.chunks_root.is_dir():
            return []
        entries = []
        for symbol_dir in sorted(path for path in self.chunks_root.iterdir() if path.is_dir()):
            for timeframe_dir in sorted(path for path in symbol_dir.iterdir() if path.is_dir()):
                symbol = symbol_dir.name.upper()
                timeframe = timeframe_dir.name.upper()
                try:
                    metadata = self.reader.metadata(symbol, timeframe)
                    entries.append(
                        {
                            "dataset_key": f"{symbol}:{timeframe}",
                            "instrument_id": symbol,
                            "timeframe": timeframe,
                            "available_range": {
                                "from_utc": metadata["first_time"],
                                "to_utc": metadata["last_time"],
                            },
                            "verified_range": None,
                            "requested_range": None,
                            "observed_range": None,
                            "quality_status": "unverified_local_cache",
                            "meta_sha256": metadata["meta_sha256"],
                            "content_sha256": None,
                            "rows": metadata["bars"],
                            "holdout": {"metadata_visible": True, "content_access": False},
                        }
                    )
                except PracticeHistoryError as exc:
                    entries.append(
                        {
                            "dataset_key": f"{symbol}:{timeframe}",
                            "instrument_id": symbol,
                            "timeframe": timeframe,
                            "available_range": None,
                            "verified_range": None,
                            "requested_range": None,
                            "observed_range": None,
                            "quality_status": "invalid",
                            "error": {"code": exc.code, "message": str(exc)},
                            "holdout": {"metadata_visible": True, "content_access": False},
                        }
                    )
        return entries

    def read_through(self, symbol, timeframe, decision_time_utc, before_bars=100, holdout_from_utc=None):
        try:
            decision_time_utc = int(decision_time_utc)
        except (TypeError, ValueError) as exc:
            raise DataAccessDenied("decision_time_utc must be unix seconds") from exc
        if holdout_from_utc is not None:
            try:
                holdout_from_utc = int(holdout_from_utc)
            except (TypeError, ValueError) as exc:
                raise DataAccessDenied("holdout_from_utc must be unix seconds") from exc
            if decision_time_utc > holdout_from_utc:
                raise DataAccessDenied("requested decision time crosses the locked holdout boundary")
        return self.reader.load_through(
            symbol,
            timeframe,
            decision_time_utc,
            before_bars=before_bars,
        )


class StaticMetadataProvider:
    """Offline fake used to contract-test provider replacement without network access."""

    def __init__(self, provider_id, datasets, capabilities=None):
        self.provider_id = str(provider_id)
        self._datasets = [dict(item) for item in datasets]
        self.capabilities = dict(capabilities or {"read_metadata": True})

    def list_datasets(self):
        return [dict(item) for item in self._datasets]


def register_data_routes(app, registry):
    @app.get("/api/data-desk/providers")
    def data_desk_providers():
        return jsonify({"providers": registry.capabilities()})

    @app.get("/api/data-desk/datasets")
    def data_desk_datasets():
        return jsonify({"datasets": registry.list_datasets()})
