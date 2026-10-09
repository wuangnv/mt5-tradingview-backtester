"""Deterministic offline contract export/check; no database/provider/listening server."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
sys.path[:0] = [str(ROOT), str(V2)]

from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.command_dispatch import DomainCommandDispatcher


def export_contracts():
    with tempfile.TemporaryDirectory(prefix="tw-command-contract-") as root, patch("trading_workspace_v2.api.PostgresStore"):
        app = create_app(dsn="offline-contract-fixture", artifact_root=root,
                         authorization=LocalWorkspaceAuthorization.for_local_owner(["tenant-a"]), learn_roots={})
        dispatcher = DomainCommandDispatcher(app)
        routes = [{"method": item["method"], "path": item["path"], "handler": item["handler"]} for item in dispatcher.manifest()]
        return {"command_routes.json": routes, "command_contracts.json": dispatcher.manifest(), "openapi.json": app.openapi()}


def check_contracts(generated):
    for name in ("command_routes.json", "command_contracts.json"):
        recorded = json.loads((V2 / "trading_workspace_v2" / name).read_text(encoding="utf-8"))
        if recorded != generated[name]:
            raise ValueError(f"frozen command contract drift: {name}")
    recorded = json.loads((V2 / "contracts/openapi.json").read_text(encoding="utf-8"))
    reference = generated["openapi.json"]
    # Axum adds operational paths/security metadata. Preserve each original
    # operation's data/error shape while allowing those explicit extensions.
    for path, operations in reference["paths"].items():
        for method, expected in operations.items():
            actual = recorded.get("paths", {}).get(path, {}).get(method, {})
            for key in ("parameters", "requestBody", "responses"):
                if actual.get(key) != expected.get(key):
                    raise ValueError(f"OpenAPI contract drift: {method.upper()} {path} {key}")
    for name, expected in reference.get("components", {}).get("schemas", {}).items():
        if recorded.get("components", {}).get("schemas", {}).get(name) != expected:
            raise ValueError(f"OpenAPI schema drift: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify frozen schemas without modifying them.")
    parser.add_argument("--output", type=Path, help="Write review candidates to a separate directory.")
    args = parser.parse_args()
    generated = export_contracts()
    if args.check or args.output is None:
        check_contracts(generated)
        print("PASS: 98 frozen domain commands and reference OpenAPI data contracts")
    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
        for name, data in generated.items():
            (args.output / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
