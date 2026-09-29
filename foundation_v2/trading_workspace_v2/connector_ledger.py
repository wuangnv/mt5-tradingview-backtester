"""Validation and public contracts for the offline Notion connector ledger.

The ledger is the backend-owned durable boundary between an MT5 report and a
future Notion adapter.  It deliberately stores no OAuth tokens, secrets,
broker identifiers, or network response bodies.  The PostgreSQL persistence
methods live on :class:`~trading_workspace_v2.store.PostgresStore`; this
module keeps the validation rules independent and easy to exercise without a
database.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import re
from typing import Any


CONNECTOR_LEDGER_SCHEMA = "mt5-connector-ledger-v1"
CONNECTOR_KIND = "notion"
CONNECTOR_STATUSES = frozenset(
    {"pending", "unknown", "succeeded", "failed", "revoked", "cancelled"}
)
_ALLOWED_SCOPES = frozenset({"read", "write", "read_write"})
_OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_DESTINATION_REF = re.compile(r"^user-selected:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")

# These names are blocked recursively.  The ledger may persist an opaque
# account reference in its dedicated ``account_ref`` column, but arbitrary
# payload/metadata must never be a path for credentials or broker material.
_FORBIDDEN_KEY_MARKERS = (
    "token",
    "secret",
    "password",
    "credential",
    "api_key",
    "private_key",
    "authorization",
    "refresh",
    "broker",
    "account_id",
    "account_ref",
    "account_number",
    "holdout",
)


class ConnectorLedgerError(ValueError):
    """Raised when a connector ledger command is malformed or unsafe."""


class ConnectorIdempotencyConflict(ConnectorLedgerError):
    """Raised when a request key is reused with different content."""


def _canonical(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ConnectorLedgerError("connector payload must be JSON serializable") from exc


def fingerprint(value: Any) -> str:
    """Return a stable SHA-256 fingerprint for an idempotency comparison."""

    return "sha256:" + hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _text(value: Any, field: str, *, max_length: int = 256) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > max_length
        or any(ord(char) < 0x20 for char in value)
    ):
        raise ConnectorLedgerError(f"{field} must be a bounded non-empty string")
    return value


def opaque_id(value: Any, field: str = "id") -> str:
    value = _text(value, field, max_length=128)
    if not _OPAQUE_ID.fullmatch(value):
        raise ConnectorLedgerError(f"{field} must be an opaque identifier")
    return value


def connector_kind(value: Any) -> str:
    if value != CONNECTOR_KIND:
        raise ConnectorLedgerError("only the notion connector is supported")
    return CONNECTOR_KIND


def status(value: Any, field: str = "status") -> str:
    if value not in CONNECTOR_STATUSES:
        raise ConnectorLedgerError(f"{field} is not a supported connector status")
    return value


def utc_timestamp(value: Any, field: str = "timestamp") -> str:
    value = _text(value, field, max_length=64)
    if not _UTC.fullmatch(value):
        raise ConnectorLedgerError(f"{field} must be an explicit UTC timestamp")
    return value


def source_revision(value: Any) -> dict[str, int]:
    """Validate the source cursor without assuming one report schema."""

    if not isinstance(value, Mapping) or not value:
        raise ConnectorLedgerError("source_revision must be a non-empty object")
    result: dict[str, int] = {}
    for raw_key, raw_revision in value.items():
        key = _text(raw_key, "source_revision key", max_length=64)
        if isinstance(raw_revision, bool) or not isinstance(raw_revision, int) or raw_revision < 0:
            raise ConnectorLedgerError(f"source_revision.{key} must be a non-negative integer")
        result[key] = raw_revision
    return result


def content_hash(value: Any, field: str = "content_sha256") -> str:
    value = _text(value, field, max_length=71)
    if not _SHA256.fullmatch(value):
        raise ConnectorLedgerError(f"{field} must be a sha256 digest")
    return value


def destination_ref(value: Any, *, allow_none: bool = True) -> str | None:
    if value is None and allow_none:
        return None
    value = _text(value, "destination_ref", max_length=256)
    if not _DESTINATION_REF.fullmatch(value):
        raise ConnectorLedgerError("destination_ref must be a bounded user-selected reference")
    return value


def _reject_sensitive(value: Any, path: str = "payload") -> None:
    if isinstance(value, Mapping):
        for raw_key, child in value.items():
            key = str(raw_key).strip().casefold().replace("-", "_")
            if any(marker in key for marker in _FORBIDDEN_KEY_MARKERS):
                raise ConnectorLedgerError(f"sensitive field is not allowed: {path}.{key}")
            _reject_sensitive(child, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _reject_sensitive(child, f"{path}[{index}]")


def json_object(value: Any, field: str, *, reject_sensitive: bool = True) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ConnectorLedgerError(f"{field} must be an object")
    out = dict(value)
    if reject_sensitive:
        _reject_sensitive(out, field)
    _canonical(out)
    return out


def validate_connection_request(
    *,
    workspace_id: Any,
    connector: Any,
    connection_id: Any,
    request_id: Any,
    idempotency_key: Any,
    account_ref: Any | None,
    scopes: Any,
    metadata: Any,
) -> dict[str, Any]:
    workspace_id = opaque_id(workspace_id, "workspace_id")
    connector = connector_kind(connector)
    connection_id = opaque_id(connection_id, "connection_id")
    request_id = opaque_id(request_id, "request_id")
    idempotency_key = opaque_id(idempotency_key, "idempotency_key")
    account_ref = None if account_ref is None else opaque_id(account_ref, "account_ref")
    if not isinstance(scopes, (list, tuple)) or not scopes:
        raise ConnectorLedgerError("scopes must be a non-empty list")
    normalized_scopes = []
    for scope in scopes:
        scope = _text(scope, "scope", max_length=64)
        if scope not in _ALLOWED_SCOPES:
            raise ConnectorLedgerError("unsupported connector scope")
        if scope not in normalized_scopes:
            normalized_scopes.append(scope)
    metadata = json_object(metadata, "metadata")
    request_fingerprint = fingerprint(
        {
            "connector": connector,
            "connection_id": connection_id,
            "request_id": request_id,
            "account_ref": account_ref,
            "scopes": normalized_scopes,
            "metadata": metadata,
        }
    )
    return {
        "workspace_id": workspace_id,
        "connector": connector,
        "connection_id": connection_id,
        "request_id": request_id,
        "idempotency_key": idempotency_key,
        "account_ref": account_ref,
        "scopes": normalized_scopes,
        "metadata": metadata,
        "fingerprint": request_fingerprint,
    }


def validate_intent_request(
    *,
    workspace_id: Any,
    intent_id: Any,
    request_id: Any,
    idempotency_key: Any,
    connection_id: Any | None,
    intent: Any,
) -> dict[str, Any]:
    workspace_id = opaque_id(workspace_id, "workspace_id")
    intent_id = opaque_id(intent_id, "intent_id")
    request_id = opaque_id(request_id, "request_id")
    idempotency_key = opaque_id(idempotency_key, "idempotency_key")
    connection_id = None if connection_id is None else opaque_id(connection_id, "connection_id")
    intent = json_object(intent, "intent")
    if intent.get("schema_version") != "mt5-notion-export-intent-v1":
        raise ConnectorLedgerError("intent schema is invalid")
    if intent.get("status") != "PREP_ONLY" or intent.get("cloud_io") is not False:
        raise ConnectorLedgerError("intent must remain PREP_ONLY with cloud_io=false")
    if intent.get("provider") != CONNECTOR_KIND:
        raise ConnectorLedgerError("intent provider must be notion")
    destination = intent.get("destination")
    if not isinstance(destination, Mapping):
        raise ConnectorLedgerError("intent destination is invalid")
    destination_selected = destination.get("user_selected")
    if not isinstance(destination_selected, bool):
        raise ConnectorLedgerError("intent destination selection is invalid")
    destination_ref_value = destination_ref(destination.get("ref"), allow_none=True)
    if destination_selected != (destination_ref_value is not None):
        raise ConnectorLedgerError("intent destination selection does not match ref")
    source = intent.get("source")
    if not isinstance(source, Mapping):
        raise ConnectorLedgerError("intent source is invalid")
    revisions = source_revision(
        {
            "session": source.get("session_revision"),
            "attempt": source.get("attempt_revision"),
        }
    )
    payload = intent.get("payload")
    if not isinstance(payload, Mapping):
        raise ConnectorLedgerError("intent payload is invalid")
    content_sha = content_hash(payload.get("content_sha256"))
    if intent.get("intent_fingerprint") != fingerprint(
        {
            "provider": CONNECTOR_KIND,
            "source": dict(source),
            "destination": dict(destination),
            "payload": dict(payload),
            "write_policy": intent.get("write_policy"),
        }
    ):
        raise ConnectorLedgerError("intent fingerprint does not match payload")
    request_fingerprint = fingerprint(
        {
            "intent_id": intent_id,
            "request_id": request_id,
            "connection_id": connection_id,
            "intent": intent,
        }
    )
    return {
        "workspace_id": workspace_id,
        "connector": CONNECTOR_KIND,
        "intent_id": intent_id,
        "request_id": request_id,
        "idempotency_key": idempotency_key,
        "connection_id": connection_id,
        "intent": intent,
        "source_revision": revisions,
        "content_sha256": content_sha,
        "destination_ref": destination_ref_value,
        "fingerprint": request_fingerprint,
    }


def validate_receipt_status(value: Any) -> str:
    return status(value, "receipt status")


__all__ = [
    "CONNECTOR_KIND",
    "CONNECTOR_LEDGER_SCHEMA",
    "CONNECTOR_STATUSES",
    "ConnectorIdempotencyConflict",
    "ConnectorLedgerError",
    "content_hash",
    "destination_ref",
    "fingerprint",
    "json_object",
    "opaque_id",
    "source_revision",
    "status",
    "utc_timestamp",
    "validate_connection_request",
    "validate_intent_request",
    "validate_receipt_status",
]
