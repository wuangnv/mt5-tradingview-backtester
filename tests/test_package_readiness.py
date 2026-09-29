import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = PROJECT_ROOT / "scripts" / "package_readiness.py"


class PackageReadinessTests(unittest.TestCase):
    def test_current_project_reports_declared_manifests_and_fail_closed_scope(self):
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), "--project-root", str(PROJECT_ROOT)],
            check=True,
            capture_output=True,
            text=True,
        )
        report = json.loads(completed.stdout)
        self.assertEqual(report["schema_version"], "package-readiness-v1")
        self.assertTrue(report["checks"]["supported_entrypoint"])
        self.assertTrue(report["checks"]["dependency_manifests"])
        self.assertFalse(report["scope"]["execution_enabled"])
        self.assertFalse(report["scope"]["broker_contacted"])
        self.assertFalse(report["scope"]["holdout_read"])

    def test_missing_required_manifest_is_a_nonzero_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "workspace_app.py").write_text("", encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), "--project-root", str(root)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 1)
            report = json.loads(completed.stdout)
            self.assertIn("requirements.txt", report["missing_required"])


if __name__ == "__main__":
    unittest.main()
