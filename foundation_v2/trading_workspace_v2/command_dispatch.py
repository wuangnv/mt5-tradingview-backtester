"""Direct domain invocation for the Axum command worker; never an HTTP gateway.

The existing endpoint closures keep financial/error semantics in one place. FastAPI
is used only once at bootstrap to extract callable and validation metadata. No ASGI
request, dependency solver, TestClient, HTTP client or listening server is involved.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.routing import APIRoute
from starlette.datastructures import Headers, URL
from starlette.responses import JSONResponse, Response
from pydantic import ValidationError

from .auth import MissingTrustedIdentity, WorkspaceMembershipDenied
from .store import StoredContractUntrusted

CONTRACT_VERSION = "api-command-v1"
ALLOWLIST_PATH = Path(__file__).with_name("command_routes.json")
OAUTH_HEADERS = {
    "cache-control": "no-store", "pragma": "no-cache",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
}


@dataclass(frozen=True)
class CommandResult:
    status: int
    body: Any = None
    text: str | None = None
    headers: dict[str, str] | None = None


@dataclass(frozen=True)
class RequestContext:
    """Only server-owned transport facts; identity is never read from headers."""
    app: Any
    client: Any
    url: URL
    headers: Headers


class DomainCommandDispatcher:
    def __init__(self, app, *, server_origin: str = "http://127.0.0.1:8010"):
        self.state = app.state
        self.server_origin = URL(server_origin)
        if self.server_origin.scheme != "http" or self.server_origin.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("command worker origin must be local HTTP")
        allowed = {(item["method"], item["path"]): item["handler"] for item in json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))}
        self.routes: list[APIRoute] = []
        observed = set()
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            for method in route.methods:
                key = (method, route.path)
                if key not in allowed:
                    raise RuntimeError(f"unreviewed domain command: {method} {route.path}")
                if route.endpoint.__name__ != allowed[key]:
                    raise RuntimeError(f"domain command handler drift: {method} {route.path}")
                observed.add(key)
            self.routes.append(route)
        if observed != set(allowed):
            raise RuntimeError("frozen domain command routes are missing")

    def manifest(self) -> list[dict]:
        items = []
        for route in self.routes:
            for method in sorted(route.methods):
                item = {"method": method, "path": route.path, "handler": route.endpoint.__name__,
                        "status_code": route.status_code or 200,
                        "safe_retry": method == "GET" and "/oauth/" not in route.path,
                        "parameters": {}}
                for kind, fields in (("path", route.dependant.path_params), ("query", route.dependant.query_params), ("body", route.dependant.body_params)):
                    item["parameters"][kind] = [
                        {"name": field.alias, "required": field.field_info.is_required(),
                         "schema": field._type_adapter.json_schema()}
                        for field in fields
                    ]
                items.append(item)
        return items

    def dispatch(self, command: dict) -> CommandResult:
        if command.get("contract_version") != CONTRACT_VERSION:
            return CommandResult(503, {"detail": "command_contract_unsupported"})
        workspace = command.get("workspace_id", "")
        if not isinstance(workspace, str) or not workspace.strip():
            return CommandResult(403, {"detail": "workspace_access_denied"})
        try:
            authorization = self.state.authorization.authorize(workspace)
        except MissingTrustedIdentity:
            return CommandResult(401, {"detail": "trusted_identity_missing"})
        except WorkspaceMembershipDenied:
            return CommandResult(403, {"detail": "workspace_access_denied"})
        if command.get("identity_id") != authorization.identity.subject:
            return CommandResult(403, {"detail": "command_identity_mismatch"})
        method, path = command.get("method"), command.get("path", "")
        if not isinstance(path, str) or "?" in path or "#" in path or not path.startswith("/"):
            return CommandResult(422, {"detail": "invalid_command_path"})
        route = None
        for candidate in self.routes:
            if method in candidate.methods and candidate.path_regex.fullmatch(path):
                route = candidate
                break
        if route is None:
            return CommandResult(404, {"detail": "Not Found"})
        path_values = route.path_regex.fullmatch(path).groupdict()
        pairs = command.get("query", [])
        if not isinstance(pairs, list) or any(not isinstance(pair, list) or len(pair) != 2 or not all(isinstance(v, str) for v in pair) for pair in pairs):
            return CommandResult(422, {"detail": "invalid_command_query"})
        query_values = dict(pairs)  # Starlette query scalar semantics use the last occurrence.
        arguments = {}
        if any(dependency.name == "workspace" for dependency in route.dependant.dependencies):
            arguments["workspace"] = authorization.workspace_id
        errors = []
        for kind, fields, values in (("path", route.dependant.path_params, path_values), ("query", route.dependant.query_params, query_values), ("body", route.dependant.body_params, None)):
            for field in fields:
                value = command.get("body") if kind == "body" else values.get(field.alias)
                location = (kind,) if kind == "body" else (kind, field.alias)
                if value is None:
                    if field.field_info.is_required():
                        errors.append({"type": "missing", "loc": location, "msg": "Field required", "input": None})
                    else:
                        arguments[field.name] = field.default
                    continue
                validated, failures = field.validate(value, arguments, loc=location)
                if failures:
                    errors.extend(failures)
                else:
                    arguments[field.name] = validated
        headers = dict(OAUTH_HEADERS) if "/connectors/notion/oauth/" in path else {}
        if errors:
            return CommandResult(422, jsonable_encoder({"detail": errors}), headers=headers)
        if route.dependant.request_param_name:
            origin = command.get("origin")
            request_headers = Headers({"origin": origin}) if isinstance(origin, str) else Headers()
            arguments[route.dependant.request_param_name] = RequestContext(
                app=SimpleNamespace(state=self.state), client=SimpleNamespace(host="127.0.0.1"),
                url=self.server_origin.replace(path=path), headers=request_headers,
            )
        try:
            result = route.endpoint(**arguments)
        except HTTPException as exc:
            headers.update(exc.headers or {})
            return CommandResult(exc.status_code, jsonable_encoder({"detail": exc.detail}), headers=headers)
        except (ValidationError, StoredContractUntrusted):
            detail = "stored_contract_untrusted" if method == "GET" and "/oauth/" not in path else "command_outcome_unknown"
            return CommandResult(503, {"detail": detail}, headers=headers)
        if isinstance(result, Response):
            headers.update(dict(result.headers))
            return CommandResult(result.status_code, text=result.body.decode("utf-8"), headers=headers)
        if isinstance(route.response_class, type) and issubclass(route.response_class, Response) and not issubclass(route.response_class, JSONResponse):
            response = route.response_class(result, status_code=route.status_code or 200)
            headers.update(dict(response.headers))
            return CommandResult(response.status_code, text=response.body.decode("utf-8"), headers=headers)
        if route.response_field:
            result, failures = route.response_field.validate(result, {}, loc=("response",))
            if failures:
                detail = "stored_contract_untrusted" if method == "GET" and "/oauth/" not in path else "command_outcome_unknown"
                return CommandResult(503, {"detail": detail}, headers=headers)
            result = route.response_field.serialize(result, mode="json", by_alias=True)
        return CommandResult(route.status_code or 200, jsonable_encoder(result), headers=headers)
