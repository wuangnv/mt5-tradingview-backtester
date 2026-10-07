"""Independent in-memory review; no Postgres/artifact/provider/broker writes."""
import json
import sys
from copy import deepcopy
from pathlib import Path
from decimal import Decimal
from types import SimpleNamespace

V2 = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(V2))
sys.path.insert(0, str(V2.parent))
from pydantic import ValidationError
from trading_workspace_v2.contracts import ReplayCreate
from trading_workspace_v2.replay import ReplayService


class MemoryStore:
    def __init__(self):
        self.created = []

    def get_record_revision(self, workspace, kind, record_id, revision):
        if record_id == "deleted-strategy":
            return {"deleted": True}
        return {"record_id": record_id, "revision": revision, "payload": {}} if (workspace, kind, record_id, revision) == ("review", "playbook", "strategy-1", 3) else None

    def create_record(self, workspace, kind, payload):
        record = {"record_id": "independent-created", "revision": 1, "payload": deepcopy(payload)}
        self.created.append((workspace, kind, record))
        return record

    def get_record(self, workspace, kind, record_id):
        return next((entry[2] for entry in self.created if entry[2]["record_id"] == record_id), None)

    def create_replay_branch_record(self, workspace, parent, revision, child, payload):
        record = {"record_id": child, "revision": 1, "payload": deepcopy(payload)}
        self.created.append((workspace, "replay", record))
        return record


class MemoryReplay(ReplayService):
    def _dataset_rows(self, workspace, dataset_id):
        if dataset_id != "dataset-1":
            raise LookupError("dataset not found")
        return SimpleNamespace(instrument_spec={"account_ccy": "EUR"}), [{"time": i} for i in range(100)]

    def view(self, workspace, record_id):
        return deepcopy(self.store.created[-1][2])


report = {"scope": "In-memory model/service creation review only", "cases": []}
valid = {"dataset_id": "dataset-1", "start_index": 17, "name": "  Independent session  ", "description": "Independent description", "starting_balance": "25000.75", "playbook_id": "strategy-1", "playbook_revision": 3, "chart_engine": "legacy"}
store = MemoryStore()
service = MemoryReplay(store, None)
model = ReplayCreate(**valid)
record = service.create("review", **model.model_dump())
assert len(store.created) == 1
assert record["payload"]["name"] == "Independent session"
assert record["payload"]["description"] == valid["description"]
assert Decimal(record["payload"]["starting_balance"]) == Decimal("25000.75")
assert record["payload"]["cursor_index"] == 17
assert record["payload"]["playbook_revision"] == 3
assert record["payload"]["chart_engine"] == "legacy"
assert record["payload"]["starting_balance_ccy"] == "EUR"
assert "execution" not in record["payload"]
report["cases"].append({"case": "One atomic metadata record before simulator initialization", "pass": True})
branched = service.branch("review", record["record_id"], 1, 10)
for key in ("name", "description", "starting_balance", "starting_balance_ccy", "playbook_id", "playbook_revision", "chart_engine"):
    assert branched["payload"][key] == record["payload"][key]
assert branched["payload"]["cursor_index"] == 10
assert branched["payload"]["parent_session_id"] == record["record_id"]
assert branched["payload"]["timing"] is not record["payload"]["timing"]
report["cases"].append({"case": "Branch retains configuration and currency with fresh timing", "pass": True})

invalid = [
    {"name": "   "}, {"name": "x" * 161}, {"description": "x" * 2001},
    {"starting_balance": "NaN"}, {"starting_balance": "Infinity"}, {"starting_balance": "-1"}, {"starting_balance": "0"},
    {"start_index": -1}, {"chart_engine": "native"}, {"playbook_id": None}, {"playbook_revision": None},
    {"playbook_revision": True}, {"unexpected": "value"},
]
for patch in invalid:
    try:
        ReplayCreate(**{**valid, **patch})
    except ValidationError:
        report["cases"].append({"case": "API model rejects " + ",".join(patch), "pass": True})
    else:
        raise AssertionError("Invalid create contract accepted " + repr(patch))

for patch, expected in [({"dataset_id": "missing"}, LookupError), ({"start_index": 100}, ValueError), ({"start_index": -1}, ValueError), ({"description": "x" * 2001}, ValueError), ({"playbook_id": "deleted-strategy"}, LookupError), ({"playbook_revision": 4}, LookupError), ({"starting_balance": "NaN"}, ValueError), ({"chart_engine": "native"}, ValueError)]:
    old_count = len(store.created)
    try:
        service.create("review", **{**valid, **patch})
    except expected:
        assert len(store.created) == old_count
        report["cases"].append({"case": "Service rejects before record: " + ",".join(patch), "pass": True})
    else:
        raise AssertionError("Service accepted invalid draft " + repr(patch))

legacy = service.create("review", **ReplayCreate(dataset_id="dataset-1").model_dump())
assert legacy["payload"]["cursor_index"] == 0
assert "starting_balance" not in legacy["payload"]
assert "playbook_id" not in legacy["payload"]
report["cases"].append({"case": "Existing dataset-only request remains compatible", "pass": True})
report["pass"] = True
Path(__file__).with_suffix(".json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"pass": True, "cases": len(report["cases"])}))
