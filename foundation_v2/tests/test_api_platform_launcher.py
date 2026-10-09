"""Restart guards must remain read-only and must reject foreign/recycled processes."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location("platform_launcher", Path(__file__).resolve().parents[1] / "scripts/run_api_platform.py")
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_child_import_paths_and_remote_hostaddr_guard(self):
        args = launcher.parser().parse_args(["--download-engine", "none"])
        with patch.dict("os.environ", {"TW_V2_DATABASE_URL": "host=localhost user=fixture"}):
            env = launcher.configuration(args)
        self.assertIn(str(launcher.PROJECT), env["PYTHONPATH"])
        self.assertTrue(Path(env["TW_V2_OPENAPI_PATH"]).is_file())
        with patch.dict("os.environ", {"TW_V2_DATABASE_URL": "host=localhost hostaddr=192.0.2.1"}):
            with self.assertRaises(launcher.PreflightError): launcher.configuration(args)

    def fake_database(self, *, active=False):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        def execute(query, parameters=None):
            response = MagicMock()
            if "SELECT to_regclass" in query:
                response.fetchone.return_value = {"name": "existing_table"}
            elif "FROM tw_schema_migrations" in query:
                response.fetchall.return_value = []
            else:
                response.fetchone.return_value = {"count": 1 if "pg_tables" in query or active else 0}
            return response
        connection.execute.side_effect = execute
        return connection

    def test_pending_schema_requires_explicit_migrate(self):
        with patch("psycopg.connect", return_value=self.fake_database()), \
             patch("trading_workspace_v2.migrations.apply_migrations") as migration:
            with self.assertRaises(launcher.PreflightError):
                launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"})
            result = launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, allow_pending=True)
            self.assertFalse(result["schema_current"])
            self.assertGreater(len(result["pending"]), 0)
            migration.assert_not_called()

    def test_existing_database_migrate_requires_backup_and_idle(self):
        with patch("psycopg.connect", return_value=self.fake_database()), \
             patch("trading_workspace_v2.migrations.apply_migrations") as migration:
            with self.assertRaises(launcher.PreflightError):
                launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, migrate=True)
            migration.assert_not_called()
            launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, migrate=True, backup_confirmed=True)
            migration.assert_called_once()
        with patch("psycopg.connect", return_value=self.fake_database(active=True)), \
             patch("trading_workspace_v2.migrations.apply_migrations") as migration:
            with self.assertRaises(launcher.PreflightError):
                launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, migrate=True, backup_confirmed=True)
            migration.assert_not_called()

    def test_child_logs_redact_database_and_tokens(self):
        env = {"TW_V2_DATABASE_URL": "host=127.0.0.1 dbname=fixture password=fixture-only-password",
               "TW_V2_METRICS_TOKEN": "fixture-only-token"}
        sanitized = launcher.sanitize_log("driver: " + env["TW_V2_DATABASE_URL"] + " password: fixture-only-password token: fixture-only-token", env)
        self.assertNotIn("fixture-only-password", sanitized)
        self.assertNotIn("fixture-only-token", sanitized)
        self.assertNotIn("host=127.0.0.1", sanitized)

    def test_check_only_rejects_mutation_before_config(self):
        for action in ("--migrate", "--stop", "--build", "--adopt-legacy-downloads"):
            with self.subTest(action=action), patch.object(launcher, "configuration") as config:
                with self.assertRaises(launcher.PreflightError):
                    launcher.main(["--check-only", action])
                config.assert_not_called()

    def test_check_only_does_not_supervise_or_migrate(self):
        with patch.object(launcher, "configuration", return_value={}), patch.object(launcher, "validate_paths"), \
             patch.object(launcher, "database_preflight", return_value={"schema_current": True}) as database, \
             patch.object(launcher, "port_is_free", return_value=False), patch.object(launcher, "supervise") as start:
            self.assertEqual(launcher.main(["--check-only"]), 0)
            self.assertFalse(database.call_args.kwargs["migrate"])
            start.assert_not_called()

    def test_pending_versions_cannot_be_allowed_on_launch(self):
        with self.assertRaises(launcher.PreflightError):
            launcher.main(["--allow-pending-migrations"])

    def test_legacy_active_job_is_found_in_both_provider_directories(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for provider in ("qdm", "dukascopy"):
                checkpoint = root / provider / "workspace" / "job-id" / "job.json"
                checkpoint.parent.mkdir(parents=True)
                checkpoint.write_text(json.dumps({"status": "running"}), encoding="utf-8")
                with self.assertRaises(launcher.PreflightError):
                    launcher.assert_no_legacy_download(root)
                checkpoint.write_text(json.dumps({"status": "paused"}), encoding="utf-8")
                launcher.assert_no_legacy_download(root)

    def test_corrupt_legacy_checkpoint_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "qdm").mkdir()
            (root / "qdm/job.json").write_text("invalid", encoding="utf-8")
            with self.assertRaises(launcher.PreflightError):
                launcher.assert_no_legacy_download(root)

    def test_foreign_or_recycled_pid_never_gets_shutdown_marker(self):
        with tempfile.TemporaryDirectory() as folder:
            args = launcher.parser().parse_args(["--manifest", str(Path(folder) / "owner.json")])
            run_id = "a" * 32
            marker = Path(folder) / f"platform-{run_id}.stop"
            expected = {"pid": 321, "created": 111, "executable": str(Path(sys.executable).resolve())}
            value = {"project": str(launcher.PROJECT.resolve()), "port": args.port, "run_id": run_id,
                     "stop_file": str(marker.resolve()), "processes": {"supervisor": expected}}
            args.manifest.write_text(json.dumps(value), encoding="utf-8")
            with patch.object(launcher, "process_identity", return_value={**expected, "created": 222}):
                with self.assertRaises(launcher.PreflightError):
                    launcher.stop_owned(args)
            self.assertFalse(marker.exists())

    def test_marker_path_cannot_escape_runtime_owner_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            args = launcher.parser().parse_args(["--manifest", str(Path(folder) / "owner.json")])
            value = {"project": str(launcher.PROJECT.resolve()), "port": args.port, "run_id": "b" * 32,
                     "stop_file": str(Path(folder).parent / "foreign.stop"), "processes": {}}
            args.manifest.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaises(launcher.PreflightError):
                launcher.owned_manifest(args)

    @unittest.skipUnless(sys.platform == "win32", "Win32 process identity")
    def test_live_self_process_identity_is_stable(self):
        import os
        first = launcher.process_identity(os.getpid())
        self.assertEqual(first, launcher.process_identity(os.getpid()))
        self.assertGreater(first["created"], 0)
        self.assertTrue(Path(first["executable"]).is_file())

    @unittest.skipUnless(sys.platform == "win32", "Win32 exited process identity")
    def test_exited_process_with_retained_handle_is_not_live(self):
        import subprocess
        child = subprocess.Popen([sys.executable, "-c", "pass"], creationflags=subprocess.CREATE_NO_WINDOW)
        child.wait(timeout=10)
        self.assertIsNone(launcher.process_identity(child.pid))

    @unittest.skipUnless(sys.platform == "win32", "Win32 profile lock")
    def test_second_supervisor_cannot_take_same_profile_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = Path(folder) / "owner.json"
            with launcher.runtime_lock(manifest):
                with self.assertRaises(launcher.PreflightError):
                    with launcher.runtime_lock(manifest):
                        self.fail("second supervisor acquired the runtime lock")
            with launcher.runtime_lock(manifest):
                pass


if __name__ == "__main__":
    unittest.main()
