import tempfile
import unittest
from pathlib import Path

from ai_provider import FakeProvider
from ai_service import AIService, canonical_hash
from tests.test_workspace_app import WorkspaceAppTests
from workspace_app import create_app


class AIFoundationTests(WorkspaceAppTests):
    def setUp(self):
        super().setUp()

    def test_default_workspace_starts_ai_off_without_key(self):
        status = self.client.get("/api/ai/status")
        self.assertEqual(status.status_code, 200)
        ai = status.json["ai"]
        self.assertEqual(ai["provider"], "offline")
        self.assertFalse(ai["provider_health"]["available"])
        self.assertFalse(ai["execution_capability"])
        self.assertFalse(ai["capabilities"]["broker_actions"])

        context_hash, _ = canonical_hash("playbook_search", "v1", {"query": "breakout", "candidates": []})
        response = self.client.post(
            "/api/ai/request",
            json={
                "job": "playbook_search",
                "context_version": "v1",
                "context_hash": context_hash,
                "state": {"query": "breakout", "candidates": []},
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["ai"]["status"], "unavailable")

    def test_fake_provider_obeys_context_hash_caps_and_never_adds_execution(self):
        fake = FakeProvider(
            {
                "playbook_search": {
                    "status": "ok",
                    "result": {"selected_id": "note-2", "match": True},
                }
            }
        )
        app = create_app(self.data_root, ai_provider=fake, ai_enabled_jobs={"playbook_search"})
        app.config["TESTING"] = True
        client = app.test_client()
        state = {
            "query": "pha vo va retest",
            "candidates": [
                {"id": "note-1", "revision": 1, "text": "risk"},
                {"id": "note-2", "revision": 4, "text": "breakout retest"},
            ],
        }
        context_hash, _ = canonical_hash("playbook_search", "playbook-search-v1", state)
        response = client.post(
            "/api/ai/request",
            json={
                "job": "playbook_search",
                "context_version": "playbook-search-v1",
                "context_hash": context_hash,
                "state": state,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["ai"]["result"]["selected_id"], "note-2")
        self.assertEqual(response.json["ai"]["context_hash"], context_hash)
        self.assertEqual(len(fake.calls), 1)

        stale = client.post(
            "/api/ai/request",
            json={
                "job": "playbook_search",
                "context_version": "playbook-search-v1",
                "context_hash": "0" * 64,
                "state": state,
            },
        )
        self.assertEqual(stale.json["ai"]["status"], "invalid_context")
        self.assertEqual(len(fake.calls), 1)

        forbidden = client.post(
            "/api/ai/request",
            json={
                "job": "playbook_search",
                "context_version": "v1",
                "state": {"query": "x", "holdout_bars": [1, 2, 3]},
            },
        )
        self.assertEqual(forbidden.status_code, 422)

    def test_provider_failure_is_feature_unavailable_and_core_stays_alive(self):
        fake = FakeProvider(available=False)
        app = create_app(self.data_root, ai_provider=fake, ai_enabled_jobs={"playbook_search"})
        app.config["TESTING"] = True
        client = app.test_client()
        state = {"query": "x", "candidates": []}
        context_hash, _ = canonical_hash("playbook_search", "v1", state)
        response = client.post(
            "/api/ai/request",
            json={"job": "playbook_search", "context_version": "v1", "context_hash": context_hash, "state": state},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["ai"]["status"], "unavailable")
        self.assertEqual(client.get("/api/runs").status_code, 200)


if __name__ == "__main__":
    unittest.main()
