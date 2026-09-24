from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
EDUCATION_ROOT = ROOT.parents[1] / "education"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.learn import LearnCatalog, LearnResourceNotFound, LearnWorkspaceNotConfigured


class U3cLearnCatalogTests(unittest.TestCase):
    def setUp(self):
        self.catalog = LearnCatalog({"tenant-a": EDUCATION_ROOT})

    def test_real_course_progress_and_glossary_are_read_without_answer_keys(self):
        overview = self.catalog.overview("tenant-a")
        self.assertEqual(overview["course"]["version"], "1.1")
        self.assertEqual(overview["course"]["module_count"], 8)
        self.assertEqual(overview["course"]["lesson_count"], 24)
        self.assertEqual(overview["progress"]["status"], "in_progress")
        self.assertEqual(overview["progress"]["current_lesson_id"], "M08-L03")
        self.assertTrue(overview["safety"]["read_only"])
        self.assertFalse(overview["safety"]["answer_keys_exposed"])
        self.assertFalse(overview["safety"]["auto_completion_enabled"])

        serialized = json.dumps(overview, ensure_ascii=False)
        self.assertNotIn("course-checks", serialized)
        self.assertNotIn("entry-check", serialized)
        self.assertNotIn('"answer"', serialized)
        self.assertNotIn('"expected"', serialized)

        glossary = self.catalog.glossary("tenant-a")
        by_term = {item["term"]: item["meaning_vi"] for item in glossary["items"]}
        self.assertEqual(by_term["Bid / ask"], "Giá bạn bán / giá bạn mua")
        self.assertIn("Long / short", by_term)

    def test_resources_are_allowlisted_and_pending_activity_stays_in_practice(self):
        course = self.catalog.resource("tenant-a", "course")
        module = self.catalog.resource("tenant-a", "module:M01")
        pending = self.catalog.resource("tenant-a", "pending-activity")
        self.assertIn("markdown", course["format"])
        self.assertIn("M01", module["resource_id"])
        self.assertEqual(pending["resource_id"], "pending-activity")

        for resource_id in ("assessments/course-checks.json", "../assessments/course-checks.json", "tutor"):
            with self.assertRaises(LearnResourceNotFound):
                self.catalog.resource("tenant-a", resource_id)

    def test_unconfigured_workspace_fails_closed(self):
        with self.assertRaises(LearnWorkspaceNotConfigured):
            self.catalog.overview("tenant-b")


class U3cLearnApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tw-u3c-learn-")
        authorization = LocalWorkspaceAuthorization.for_local_owner(["tenant-a", "tenant-b"])
        self.client = TestClient(
            create_app(
                dsn=self.dsn,
                artifact_root=self.temp.name,
                authorization=authorization,
                learn_roots={"tenant-a": EDUCATION_ROOT},
            )
        )

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def test_routes_require_membership_and_explicit_workspace_binding(self):
        tenant_a = {"X-Workspace-Id": "tenant-a"}
        tenant_b = {"X-Workspace-Id": "tenant-b"}

        overview = self.client.get("/api/v2/learn/overview", headers=tenant_a)
        self.assertEqual(overview.status_code, 200)
        self.assertEqual(overview.json()["progress"]["current_lesson_id"], "M08-L03")

        glossary = self.client.get("/api/v2/learn/glossary", headers=tenant_a)
        self.assertEqual(glossary.status_code, 200)
        self.assertGreater(glossary.json()["count"], 10)

        course = self.client.get("/api/v2/learn/resources/course", headers=tenant_a)
        self.assertEqual(course.status_code, 200)
        self.assertNotIn("assessments/course-checks.json", course.json()["content"])

        cross_tenant = self.client.get("/api/v2/learn/overview", headers=tenant_b)
        self.assertEqual(cross_tenant.status_code, 404)
        self.assertEqual(cross_tenant.json()["detail"], "learn_not_configured")

        unauthorized = self.client.get("/api/v2/learn/overview", headers={"X-Workspace-Id": "tenant-c"})
        self.assertEqual(unauthorized.status_code, 403)
        self.assertEqual(unauthorized.json()["detail"], "workspace_access_denied")

        answer_key = self.client.get(
            "/api/v2/learn/resources/assessments%2Fcourse-checks.json",
            headers=tenant_a,
        )
        self.assertEqual(answer_key.status_code, 404)


if __name__ == "__main__":
    unittest.main()
