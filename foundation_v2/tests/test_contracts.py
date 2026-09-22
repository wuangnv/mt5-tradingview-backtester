from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(V2) not in sys.path:
    sys.path.insert(0, str(V2))

from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.retained import SourceSpec


class ContractTests(unittest.TestCase):
    def test_retained_modules_stay_framework_independent(self):
        for name in (
            "data_contracts.py",
            "data_costs.py",
            "data_news.py",
            "evidence_metrics.py",
            "risk_lab.py",
            "prop_profile.py",
        ):
            path = ROOT / name
            tree = ast.parse(path.read_text(encoding="utf-8"))
            imports = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports.update(alias.name.split(".")[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports.add(node.module.split(".")[0])
            self.assertNotIn("flask", {item.lower() for item in imports})
            self.assertNotIn("sqlite3", {item.lower() for item in imports})
            self.assertNotIn("execution_service", imports)
            self.assertNotIn("mt5_data", imports)

    def test_retained_ai_boundary_has_no_broker_or_execution_imports(self):
        forbidden = {"execution_service", "mt5_data", "demo_broker", "workspace_risk"}
        for name in ("ai_provider.py", "ai_service.py"):
            path = ROOT / name
            tree = ast.parse(path.read_text(encoding="utf-8"))
            imports = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports.update(alias.name.split(".")[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports.add(node.module.split(".")[0])
            self.assertFalse(forbidden.intersection(imports), f"{name} imported broker/execution code")

    def test_source_contract_matches_retained_validator(self):
        source = DatasetSource(
            source_id="fixture-eurusd",
            provider="synthetic-f6",
            instrument_mapping={"EURUSD": "EURUSD"},
            license_use="qa-only",
            retrieved_at_utc="2026-09-22T00:00:00Z",
            export_settings="deterministic-fixture-v1",
        )
        retained = SourceSpec.from_mapping(source.model_dump())
        self.assertEqual(retained.source_id, source.source_id)


if __name__ == "__main__":
    unittest.main()
