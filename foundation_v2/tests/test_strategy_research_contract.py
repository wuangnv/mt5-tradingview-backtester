from __future__ import annotations

import unittest

from pydantic import ValidationError

from trading_workspace_v2.contracts import PlaybookDraft, PlaybookForkRequest
from trading_workspace_v2.strategy_contracts import StrategyResearchSpec


def hypothesis(**overrides):
    payload = {
        "family": "smc",
        "label": "SMC displacement hypothesis",
        "methodology_version": "smc-notes-v1",
        "hypothesis": "Displacement after a liquidity sweep may improve directional follow-through.",
        "entry_definition": "Record a closed-bar displacement and the first eligible next-bar entry.",
        "exit_definition": "Record a fixed horizon or explicit protective bracket.",
        "invalidation_definition": "Invalidate when the structural premise is broken before entry.",
        "signal_features": ["liquidity_sweep", "displacement", "market_structure"],
    }
    payload.update(overrides)
    return payload


class StrategyResearchContractTests(unittest.TestCase):
    def test_ict_smc_and_price_action_are_capturable_without_engine_claim(self):
        for family in ("ict", "smc", "price_action"):
            with self.subTest(family=family):
                spec = StrategyResearchSpec.model_validate(hypothesis(family=family))
                self.assertEqual(spec.execution_capability, "needs-definition")
                self.assertEqual(spec.edge_status, "unproven")
                self.assertFalse(spec.evaluation.holdout_access)
                self.assertTrue(spec.evaluation.walk_forward_required)

    def test_engine_supported_requires_deterministic_definition(self):
        with self.assertRaisesRegex(ValidationError, "deterministic definitions"):
            StrategyResearchSpec.model_validate(
                hypothesis(execution_capability="engine-supported")
            )

    def test_edge_status_requires_durable_evidence_reference(self):
        with self.assertRaisesRegex(ValidationError, "evidence_refs"):
            StrategyResearchSpec.model_validate(hypothesis(edge_status="empirical_pending"))

        spec = StrategyResearchSpec.model_validate(
            hypothesis(edge_status="software_only", evidence_refs=["evidence/local-run.json"])
        )
        self.assertEqual(spec.evidence_refs, ["evidence/local-run.json"])

    def test_holdout_access_is_hard_locked_false(self):
        with self.assertRaises(ValidationError):
            StrategyResearchSpec.model_validate(hypothesis(evaluation={"holdout_access": True}))

    def test_playbook_contract_persists_spec_without_mixing_it_into_engine_rules(self):
        spec = StrategyResearchSpec.model_validate(hypothesis(family="ict"))
        draft = PlaybookDraft(
            name="ICT hypothesis",
            execution_capability="needs-definition",
            rules={"entry": "manual observation"},
            strategy_spec=spec,
        )
        payload = draft.model_dump(mode="json")
        self.assertEqual(payload["strategy_spec"]["family"], "ict")
        self.assertEqual(payload["rules"], {"entry": "manual observation"})

        fork = PlaybookForkRequest(expected_revision=1, strategy_spec=spec)
        self.assertEqual(fork.strategy_spec.family, "ict")


if __name__ == "__main__":
    unittest.main()
