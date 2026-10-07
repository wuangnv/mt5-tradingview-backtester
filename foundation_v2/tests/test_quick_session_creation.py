from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace
import unittest
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for entry in (str(ROOT), str(ROOT / "foundation_v2")):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from pydantic import ValidationError
from trading_workspace_v2.contracts import ReplayCreate
from trading_workspace_v2.replay import ReplayService


class MemoryStore:
    def __init__(self):
        self.records = {}

    def get_record_revision(self, workspace, kind, record_id, revision):
        if (workspace, kind, record_id, revision) == ("tenant-a", "playbook", "strategy", 3):
            return {"deleted": False}
        if record_id == "deleted":
            return {"deleted": True}
        return None

    def create_record(self, workspace, kind, payload):
        record_id = str(len(self.records))
        record = {"record_id": record_id, "revision": 1, "payload": deepcopy(payload)}
        self.records[record_id] = record
        return record

    def get_record(self, workspace, kind, record_id):
        return self.records.get(record_id)

    def create_replay_branch_record(self, workspace, parent, revision, child, payload):
        record = {"record_id": child, "revision": 1, "payload": deepcopy(payload)}
        self.records[child] = record
        return record


class MemoryReplay(ReplayService):
    def _dataset_rows(self, workspace, dataset_id):
        if dataset_id != "dataset":
            raise LookupError("dataset not found")
        return SimpleNamespace(instrument_spec={"account_ccy": "EUR"}), [{}] * 100

    def view(self, workspace, record_id):
        return deepcopy(self.store.records[record_id])


class QuickSessionCreationTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.service = MemoryReplay(self.store, None)
        self.draft = dict(dataset_id="dataset", start_index=17, name="  Morning session  ",
                          description="Practice", starting_balance="25000.75",
                          playbook_id="strategy", playbook_revision=3, chart_engine="legacy")

    def test_single_atomic_record_with_exact_capital_and_strategy(self):
        record = self.service.create("tenant-a", **ReplayCreate(**self.draft).model_dump())
        self.assertEqual(len(self.store.records), 1)
        payload = record["payload"]
        self.assertEqual(payload["name"], "Morning session")
        self.assertEqual(payload["description"], "Practice")
        self.assertEqual(Decimal(payload["starting_balance"]), Decimal("25000.75"))
        self.assertEqual(payload["starting_balance_ccy"], "EUR")
        self.assertEqual(payload["cursor_index"], 17)
        self.assertEqual(payload["playbook_revision"], 3)
        self.assertEqual(payload["chart_engine"], "legacy")
        self.assertNotIn("execution", payload)

    def test_invalid_api_contracts(self):
        patches = [{"name": " "}, {"name": "x" * 161}, {"description": "x" * 2001},
                   {"starting_balance": "NaN"}, {"starting_balance": "Infinity"},
                   {"starting_balance": "0"}, {"starting_balance": "-1"},
                   {"playbook_id": None}, {"playbook_revision": None},
                   {"playbook_revision": True}, {"start_index": -1}, {"chart_engine": "new"}]
        for patch in patches:
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                ReplayCreate(**{**self.draft, **patch})

    def test_service_errors_write_no_record(self):
        for patch, error in [({"dataset_id": "missing"}, LookupError),
                             ({"start_index": -1}, ValueError), ({"start_index": 100}, ValueError),
                             ({"starting_balance": "NaN"}, ValueError),
                             ({"chart_engine": "new"}, ValueError),
                             ({"description": "x" * 2001}, ValueError),
                             ({"playbook_revision": 4}, LookupError),
                             ({"playbook_id": "deleted"}, LookupError),
                             ({"playbook_revision": None}, ValueError)]:
            with self.subTest(patch=patch), self.assertRaises(error):
                self.service.create("tenant-a", **{**self.draft, **patch})
            self.assertEqual(len(self.store.records), 0)
        with self.assertRaises(LookupError):
            self.service.create("tenant-b", **self.draft)
        self.assertEqual(len(self.store.records), 0)

    def test_dataset_only_request_still_works(self):
        payload = self.service.create("tenant-a", **ReplayCreate(dataset_id="dataset").model_dump())["payload"]
        self.assertEqual(payload["cursor_index"], 0)
        self.assertNotIn("starting_balance", payload)
        self.assertNotIn("playbook_id", payload)

    def test_branch_preserves_configuration_without_initializing_execution(self):
        parent = self.service.create("tenant-a", **ReplayCreate(**self.draft).model_dump())
        child = self.service.branch("tenant-a", parent["record_id"], 1, 10)
        for key in ("name", "description", "starting_balance", "starting_balance_ccy",
                    "playbook_id", "playbook_revision", "chart_engine"):
            self.assertEqual(child["payload"][key], parent["payload"][key])
        self.assertEqual(child["payload"]["parent_session_id"], parent["record_id"])
        self.assertEqual(child["payload"]["cursor_index"], 10)
        self.assertNotIn("execution", child["payload"])
