from __future__ import annotations

import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "foundation_v2")]

from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.responses import Response

from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization, LocalTrustedIdentityAdapter, ServerWorkspaceMemberships
from trading_workspace_v2.command_dispatch import CONTRACT_VERSION, CommandResult, DomainCommandDispatcher
from trading_workspace_v2.api_command_worker import ApiCommandWorker, CommandQueue


class DirectDomainCommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        with patch("trading_workspace_v2.api.PostgresStore"):
            self.app = create_app(dsn="fixture-only", artifact_root=self.temp.name,
                                  authorization=LocalWorkspaceAuthorization.for_local_owner(["tenant-a"]), learn_roots={})
        self.dispatcher = DomainCommandDispatcher(self.app)

    def tearDown(self):
        self.temp.cleanup()

    def command(self, method, path, **kwargs):
        return {"contract_version": CONTRACT_VERSION, "workspace_id": "tenant-a", "identity_id": "local-owner",
                "method": method, "path": path, "query": [], **kwargs}

    def test_manifest_freezes_all_98_routes_and_actual_validation_schema(self):
        manifest = self.dispatcher.manifest()
        self.assertEqual(len(manifest), 98)
        current = json.loads((ROOT / "foundation_v2/trading_workspace_v2/command_contracts.json").read_text(encoding="utf-8"))
        self.assertEqual(current, manifest)
        replay = next(item for item in manifest if item["path"] == "/api/v2/replay/sessions/{session_id}" and item["method"] == "GET")
        interval = next(field for field in replay["parameters"]["query"] if field["name"] == "advance_interval_seconds")
        self.assertEqual(interval["schema"]["anyOf"][0]["minimum"], 1)
        self.assertFalse(next(item for item in manifest if item["path"].endswith("oauth/callback"))["safe_retry"])

    def test_unknown_future_route_fails_closed_at_registration(self):
        self.app.get("/future-unreviewed")(lambda: {})
        with self.assertRaisesRegex(RuntimeError, "unreviewed"):
            DomainCommandDispatcher(self.app)

    def test_missing_identity_and_cross_workspace_never_invoke_domain(self):
        self.app.state.replay.view = Mock()
        for overrides, detail in (({"workspace_id": "tenant-b"}, "workspace_access_denied"),
                                  ({"workspace_id": None}, "workspace_access_denied"),
                                  ({"identity_id": "forged-owner"}, "command_identity_mismatch")):
            result = self.dispatcher.dispatch(self.command("GET", "/api/v2/replay/sessions/test", **overrides))
            self.assertEqual((result.status, result.body), (403, {"detail": detail}))
        self.app.state.replay.view.assert_not_called()
        self.app.state.authorization = LocalWorkspaceAuthorization(LocalTrustedIdentityAdapter(None), ServerWorkspaceMemberships())
        self.assertEqual(self.dispatcher.dispatch(self.command("GET", "/health")).status, 401)

    def test_query_body_validation_matches_reference_http_without_worker_http(self):
        cases = [self.command("GET", "/api/v2/replay/sessions/test", query=[["advance_interval_seconds", "0"]]),
                 self.command("GET", "/api/v2/replay/sessions/test", query=[["advance_interval_seconds", "86401"]]),
                 self.command("GET", "/api/v2/replay/sessions/test", query=[["cursor_index", "bad"]]),
                 self.command("POST", "/api/v2/replay/sessions", body={}),
                 self.command("POST", "/api/v2/replay/sessions")]
        # TestClient is a reference-only oracle here; the dispatcher/worker never uses it.
        with TestClient(self.app) as reference:
            for case in cases:
                response = reference.request(case["method"], case["path"], params=case["query"],
                                             json=case.get("body"), headers={"X-Workspace-Id": "tenant-a"})
                result = self.dispatcher.dispatch(case)
                self.assertEqual(result.status, response.status_code)
                self.assertEqual(result.body, response.json())

    def test_every_registered_route_rejects_forged_identity_before_domain_call(self):
        for route in self.dispatcher.manifest():
            path = re.sub(r"\{[^}]+\}", "fixture", route["path"])
            result = self.dispatcher.dispatch(self.command(route["method"], path, identity_id="forged"))
            self.assertEqual((result.status, result.body), (403, {"detail": "command_identity_mismatch"}), route)

    def test_all_required_body_route_validation_matches_reference(self):
        checked = 0
        with TestClient(self.app) as client:
            for route in self.dispatcher.routes:
                if not any(field.field_info.is_required() for field in route.dependant.body_params):
                    continue
                path = re.sub(r"\{[^}]+\}", "fixture", route.path)
                for method in route.methods:
                    result = self.dispatcher.dispatch(self.command(method, path))
                    response = client.request(method, path, headers={"X-Workspace-Id": "tenant-a"})
                    self.assertEqual((result.status, result.body), (response.status_code, response.json()), route.path)
                    self.assertEqual(result.status, 422)
                    checked += 1
        self.assertGreater(checked, 30)

    def test_query_duplicate_values_follow_browser_last_value_semantics(self):
        self.app.state.replay.view = Mock(return_value={"id": "fixture"})
        result = self.dispatcher.dispatch(self.command("GET", "/api/v2/replay/sessions/test",
                                                     query=[["cursor_index", "3"], ["cursor_index", "7"]]))
        self.assertEqual(result.body, {"id": "fixture"})
        self.app.state.replay.view.assert_called_once_with("tenant-a", "test", cursor_index=7, advance_interval_seconds=None)

    def test_typed_financial_input_and_created_status_match_reference(self):
        from decimal import Decimal
        self.app.state.replay.create = Mock(return_value={"session_id": "fixture"})
        command = self.command("POST", "/api/v2/replay/sessions", body={"dataset_id": "fixture", "starting_balance": "10000.01"})
        result = self.dispatcher.dispatch(command)
        self.assertEqual((result.status, result.body), (201, {"session_id": "fixture"}))
        self.assertEqual(self.app.state.replay.create.call_args.kwargs["starting_balance"], Decimal("10000.01"))

    def test_catalog_response_model_validates_and_serializes_exact_defaults(self):
        self.app.state.replay.list_sessions = Mock(return_value=[{
            "record_id": "fixture", "revision": 1, "cursor_index": 0, "status": "ready", "dataset_available": False,
            "has_execution": False, "created_at_utc": "2026-10-09T00:00:00Z", "updated_at_utc": "2026-10-09T00:00:00Z",
        }])
        command = self.command("GET", "/api/v2/replay/sessions")
        result = self.dispatcher.dispatch(command)
        with TestClient(self.app) as client:
            response = client.get(command["path"], headers={"X-Workspace-Id": "tenant-a"})
        self.assertEqual(result.body, response.json())

    def test_revoked_workspace_and_unsupported_envelope_cannot_execute_queued_command(self):
        self.app.state.replay.view = Mock()
        command = self.command("GET", "/api/v2/replay/sessions/test")
        self.app.state.authorization.memberships.revoke("local-owner", "tenant-a")
        self.assertEqual(self.dispatcher.dispatch(command).status, 403)
        self.assertEqual(self.dispatcher.dispatch({**command, "contract_version": "future"}).status, 503)
        self.app.state.replay.view.assert_not_called()

    def test_domain_error_status_and_detail_preserved(self):
        self.app.state.replay.view = Mock(side_effect=LookupError("fixture"))
        result = self.dispatcher.dispatch(self.command("GET", "/api/v2/replay/sessions/test"))
        self.assertEqual((result.status, result.body), (404, {"detail": "replay_not_found"}))
        result = self.dispatcher.dispatch(self.command("POST", "/api/v2/execution/intents"))
        self.assertEqual((result.status, result.body), (403, {"detail": "broker_execution_locked"}))

    def test_corrupt_stored_contract_returns_explicit_untrusted_error(self):
        from trading_workspace_v2.store import StoredContractUntrusted
        self.app.state.replay.view = Mock(side_effect=StoredContractUntrusted())
        result = self.dispatcher.dispatch(self.command("GET", "/api/v2/replay/sessions/test"))
        self.assertEqual((result.status, result.body), (503, {"detail": "stored_contract_untrusted"}))

    def test_mutation_stored_contract_error_preserves_unknown_outcome(self):
        from trading_workspace_v2.store import StoredContractUntrusted
        self.app.state.replay.create = Mock(side_effect=StoredContractUntrusted())
        result = self.dispatcher.dispatch(self.command("POST", "/api/v2/replay/sessions",
                                                     body={"dataset_id": "fixture"}))
        self.assertEqual((result.status, result.body), (503, {"detail": "command_outcome_unknown"}))

    def test_session_request_context_has_only_trusted_identity(self):
        result = self.dispatcher.dispatch(self.command("GET", "/api/v2/session/status"))
        self.assertEqual(result.status, 200)
        with TestClient(self.app) as client:
            expected = client.get("/api/v2/session/status", headers={"X-Workspace-Id": "tenant-a"}).json()
        result.body["session"].pop("issued_at_utc")
        expected["session"].pop("issued_at_utc")
        self.assertEqual(result.body, expected)

    def test_oauth_error_headers_and_local_origin_preserved_without_provider_call(self):
        self.app.state.notion_oauth.status = Mock(return_value={"configured": False})
        result = self.dispatcher.dispatch(self.command("POST", "/api/v2/connectors/notion/oauth/start"))
        self.assertEqual((result.status, result.body), (403, {"detail": "notion_oauth_origin_required"}))
        self.assertEqual(result.headers["cache-control"], "no-store")
        result = self.dispatcher.dispatch(self.command("GET", "/api/v2/connectors/notion/oauth/callback", query=[["error", "denied"]]))
        # No OAuth configuration means fail before token exchange.
        self.assertEqual((result.status, result.body), (503, {"detail": "notion_oauth_not_configured"}))

    def test_utf8_csv_response_status_and_download_headers(self):
        route = next(route for route in self.dispatcher.routes if route.path.endswith("/analytics.csv") and "replay" in route.path)
        route.endpoint = lambda **_: Response("symbol,pnl\nEURUSD,1.25\n", media_type="text/csv; charset=utf-8",
                                             headers={"Content-Disposition": 'attachment; filename="fixture.csv"'})
        result = self.dispatcher.dispatch(self.command("GET", "/api/v2/replay/sessions/test/analytics.csv"))
        self.assertEqual(result.status, 200)
        self.assertEqual(result.text, "symbol,pnl\nEURUSD,1.25\n")
        self.assertIn("fixture.csv", result.headers["content-disposition"])

    def test_declared_plain_text_response_class_is_preserved(self):
        route = next(route for route in self.dispatcher.routes if route.path.endswith("oauth/callback"))
        route.endpoint = lambda **_: "fixture callback response"
        result = self.dispatcher.dispatch(self.command("GET", "/api/v2/connectors/notion/oauth/callback"))
        self.assertIsNone(result.body)
        self.assertEqual(result.text, "fixture callback response")
        self.assertIn("text/plain", result.headers["content-type"])


class DurableCommandWorkerTests(unittest.TestCase):
    def worker(self, *, result=None):
        queue, dispatcher = MagicMock(), Mock()
        queue.claim.return_value = {"command_id": "fixture", "attempt_no": 1, "lease_token": "token",
                                    "method": "GET", "body": {"request": "fixture"}, "query": [], "path": "/fixture"}
        queue.finish.return_value = True
        queue.mutation_guard.return_value.__enter__.return_value = True
        dispatcher.dispatch.return_value = result or CommandResult(201, {"saved": True})
        return ApiCommandWorker(queue, dispatcher, worker_id="fixture-worker"), queue, dispatcher

    def test_result_published_once_with_original_fencing_identity(self):
        worker, queue, dispatcher = self.worker()
        self.assertTrue(worker.run_once())
        queue.finish.assert_called_once_with(queue.claim.return_value, dispatcher.dispatch.return_value)
        self.assertIsNone(worker._command)

    def test_failed_publication_is_not_reexecuted(self):
        worker, queue, dispatcher = self.worker()
        queue.finish.return_value = False
        self.assertTrue(worker.run_once())
        dispatcher.dispatch.assert_called_once()
        queue.finish.assert_called_once()

    def test_workspace_physical_lock_blocks_domain_execution(self):
        worker, queue, dispatcher = self.worker()
        queue.mutation_guard.return_value.__enter__.return_value = False
        worker.run_once()
        dispatcher.dispatch.assert_not_called()
        self.assertEqual(queue.finish.call_args.args[1].body, {"detail": "command_workspace_busy"})

    def test_payload_and_result_limits_do_not_grow_without_bound(self):
        worker, queue, dispatcher = self.worker()
        worker.max_request_bytes = 1
        worker.run_once()
        dispatcher.dispatch.assert_not_called()
        self.assertEqual(queue.finish.call_args.args[1].status, 413)
        worker, queue, dispatcher = self.worker(result=CommandResult(200, text="large"))
        worker.max_result_bytes = 1
        worker.run_once()
        self.assertEqual(queue.finish.call_args.args[1].body, {"detail": "command_result_too_large"})

    def test_exception_does_not_leak_driver_or_payload_secret(self):
        worker, queue, dispatcher = self.worker()
        dispatcher.dispatch.side_effect = ValueError("PASSWORD-sensitive")
        worker.run_once()
        self.assertEqual(queue.finish.call_args.args[1].body, {"detail": "command_execution_failed"})

    def test_mutation_exception_or_oversize_result_keeps_outcome_unknown(self):
        for method, path in (("POST", "/fixture"), ("GET", "/oauth/callback")):
            with self.subTest(method=method, path=path):
                worker, queue, dispatcher = self.worker()
                queue.claim.return_value.update(method=method, path=path)
                dispatcher.dispatch.side_effect = RuntimeError("failure after commit")
                worker.run_once()
                self.assertEqual(queue.finish.call_args.args[1].body, {"detail": "command_outcome_unknown"})
                dispatcher.dispatch.assert_called_once()
                worker, queue, dispatcher = self.worker(result=CommandResult(200, text="large"))
                queue.claim.return_value.update(method=method, path=path)
                worker.max_result_bytes = 1
                worker.run_once()
                self.assertEqual(queue.finish.call_args.args[1].body, {"detail": "command_outcome_unknown"})

    def test_expired_mutations_never_automatically_retry_and_results_require_live_lease(self):
        store = MagicMock()
        conn = store.connect.return_value.__enter__.return_value
        queue = CommandQueue(store)
        queue.recover()
        sql = [call.args[0] for call in conn.execute.call_args_list]
        self.assertIn("method='GET'", sql[0])
        self.assertIn("attempt_no < max_attempts", sql[0])
        self.assertIn("command_outcome_unknown", sql[1])
        queue.finish({"command_id": "fixture", "lease_token": "token", "attempt_no": 1}, CommandResult(200, {}))
        self.assertIn("lease_expires_at_utc>CURRENT_TIMESTAMP", conn.execute.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
