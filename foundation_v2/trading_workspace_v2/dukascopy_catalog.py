"""Cached public Dukascopy instrument metadata; no quotes or historical downloads."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx

from .data_sources import DEFAULT_CAPABILITIES

ENDPOINT = "https://jetta.dukascopy.com/v1/instruments"
MAX_BYTES = 2 * 1024 * 1024
STALE_SECONDS = 7 * 86400


def normalize_instruments(payload):
    if not isinstance(payload, dict):
        raise ValueError("invalid_catalog")
    instruments, groups = payload.get("instruments"), payload.get("groups")
    if not isinstance(instruments, list) or not 0 < len(instruments) <= 10000:
        raise ValueError("invalid_catalog")
    if not isinstance(groups, list) or len(groups) > 1000:
        raise ValueError("invalid_catalog")
    group_index = {}
    for group in groups:
        if (not isinstance(group, dict) or type(group.get("id")) is not int
                or group["id"] in group_index or not isinstance(group.get("code"), str)):
            raise ValueError("invalid_catalog")
        if group.get("parentId") is not None and type(group["parentId"]) is not int:
            raise ValueError("invalid_catalog")
        group_index[group["id"]] = group
    classes = {"FX": "fx", "FX_METALS": "metal", "CMD_METALS": "metal",
               "CMD_ENERGY": "energy", "CMD_AGRICULTURAL": "agriculture",
               "IDX": "index", "STCK_CFD": "stock", "ETF_CFD": "etf",
               "BND_CFD": "bond", "VCCY": "crypto", "CMD": "commodity"}
    result, seen = [], set()
    codes = set()
    for item in instruments:
        if not isinstance(item, dict):
            raise ValueError("invalid_catalog")
        if not isinstance(item.get("name"), str) or not isinstance(item.get("code"), str):
            raise ValueError("invalid_catalog")
        symbol = item["name"].strip().upper()
        code = item["code"].strip()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9._/+-]{0,79}", symbol) or symbol in seen:
            raise ValueError("invalid_catalog")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,79}", code) or code in codes:
            raise ValueError("invalid_catalog")
        pip_value, price_scale = item.get("pipValue"), item.get("priceScale")
        if (type(pip_value) not in (int, float) or not 0 < pip_value < math.inf
                or (price_scale is not None and (type(price_scale) is not int or not 0 <= price_scale <= 12))):
            raise ValueError("invalid_catalog")
        group_id = item.get("groupId")
        if group_id is not None and type(group_id) is not int:
            raise ValueError("invalid_catalog")
        group = group_index.get(group_id)
        cursor, visited, asset_class = group, set(), ""
        while cursor:
            if cursor["id"] in visited:
                raise ValueError("invalid_catalog")
            visited.add(cursor["id"])
            if not asset_class:
                asset_class = classes.get(cursor["code"], "")
            cursor = group_index.get(cursor.get("parentId"))
        seen.add(symbol)
        codes.add(code)
        result.append({"instrument_id": symbol, "provider_code": code,
                       "pip_value": pip_value, "price_scale": price_scale,
                       "name": str(item.get("description") or symbol)[:240],
                       "provider": "Dukascopy", "provider_id": "dukascopy-catalog",
                       "asset_class": asset_class, "provider_group_id": group_id,
                       "provider_group": group["code"] if group else ""})
    return sorted(result, key=lambda item: item["instrument_id"])


class DukascopyCatalog:
    provider_id = "dukascopy-catalog"
    capabilities = dict(DEFAULT_CAPABILITIES)
    readiness = {"source_kind": "provider_metadata", "connection_mode": "cached_metadata",
                 "network_access": True, "oauth_required": False,
                 "entitlement_status": "metadata_only", "production_ready": False}

    def __init__(self, path: Path, *, client=None):
        self.path = Path(path)
        self._client = client
        self._lock = threading.Lock()
        self._refresh_lock = threading.Lock()
        self._snapshot = None
        self._error = None
        self._next_refresh = 0.0
        self._load()

    def _load(self):
        if not self.path.exists():
            return
        try:
            if self.path.stat().st_size > MAX_BYTES:
                raise ValueError("invalid_cache")
            snapshot = json.loads(self.path.read_text(encoding="utf-8"))
            if snapshot["version"] != 2 or snapshot["source"] != ENDPOINT:
                raise ValueError("invalid_cache")
            items = normalize_instruments(snapshot["raw_catalog"])
            retrieved = datetime.fromisoformat(snapshot["retrieved_at_utc"])
            if retrieved.tzinfo is None or retrieved.timestamp() > time.time() + 300:
                raise ValueError("invalid_cache")
            digest = hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()
            if digest != snapshot["sha256"]:
                raise ValueError("invalid_cache")
            self._snapshot = {**snapshot, "items": items}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            self._error = "invalid_cache"

    def status(self):
        with self._lock:
            snapshot = self._snapshot
            age = time.time() - datetime.fromisoformat(snapshot["retrieved_at_utc"]).timestamp() if snapshot else None
            return {"provider_id": self.provider_id, "configured": True,
                    "status": "cached" if snapshot else "empty",
                    "retrieved_at_utc": snapshot["retrieved_at_utc"] if snapshot else None,
                    "item_count": len(snapshot["items"]) if snapshot else 0,
                    "stale": age is not None and age > STALE_SECONDS,
                    "error": self._error,
                    "refresh_available": time.monotonic() >= self._next_refresh,
                    "retry_after_seconds": max(0, int(self._next_refresh - time.monotonic()) + 1)}

    def list_datasets(self, workspace_id):
        return []

    def list_instruments(self, workspace_id):
        with self._lock:
            return [dict(item) for item in self._snapshot["items"]] if self._snapshot else []

    def refresh(self):
        with self._refresh_lock:
            self._refresh()

    def _set_error(self, error):
        with self._lock:
            self._error = error

    def _refresh(self):
        with self._lock:
            if time.monotonic() < self._next_refresh:
                return
            self._next_refresh = time.monotonic() + 60
        client = self._client or httpx.Client(timeout=15, follow_redirects=False)
        try:
            with client.stream("GET", ENDPOINT) as response:
                if response.status_code == 429:
                    with self._lock:
                        self._error = "rate_limited"
                        self._next_refresh = time.monotonic() + 300
                    return
                if response.status_code != 200:
                    self._set_error("source_unavailable")
                    return
                raw = bytearray()
                started = time.monotonic()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_BYTES or time.monotonic() - started > 20:
                        raise ValueError("invalid_catalog")
            payload = json.loads(raw)
            items = normalize_instruments(payload)
            # Retain only fields needed to rebuild symbol mapping and group classification.
            public = {"instruments": [{"name": i["instrument_id"], "code": i["provider_code"],
                                       "description": i["name"], "groupId": i["provider_group_id"],
                                       "pipValue": i["pip_value"], "priceScale": i["price_scale"]}
                                      for i in items],
                      "groups": [{"id": g["id"], "code": g["code"], "parentId": g.get("parentId")}
                                 for g in payload["groups"]]}
            snapshot = {"version": 2, "source": ENDPOINT,
                        "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
                        "sha256": hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest(),
                        "raw_catalog": public}
            encoded = json.dumps(snapshot, ensure_ascii=False).encode("utf-8")
            if len(encoded) > MAX_BYTES:
                raise ValueError("invalid_catalog")
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_name(f".{self.path.name}.{uuid4().hex}.tmp")
            try:
                temp.write_bytes(encoded)
                os.replace(temp, self.path)
            finally:
                temp.unlink(missing_ok=True)
            with self._lock:
                self._snapshot = {**snapshot, "items": items}
                self._error = None
        except httpx.HTTPError:
            self._set_error("source_unavailable")
        except (ValueError, TypeError, KeyError):
            self._set_error("invalid_response")
        except OSError:
            self._set_error("cache_write_failed")
        finally:
            if self._client is None:
                client.close()
