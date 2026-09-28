from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import StringIO
import json

from trading_workspace_v2.owner_absence_host_cli import EXIT_OK, EXIT_UNTRUSTED, main
from trading_workspace_v2.owner_absence_host import OwnerAbsenceHostSupervisor
from trading_workspace_v2.owner_absence_safety import OwnerAbsencePolicy
from trading_workspace_v2.owner_absence_supervisor import SupervisorIdentity


UTC = timezone.utc
NOW = datetime(2026, 9, 28, 16, 0, tzinfo=UTC)


def ready_policy(**overrides: object) -> OwnerAbsencePolicy:
    values: dict[str, object] = {
        "mode": "research",
        "kill_switch_active": False,
        "lease_id": "lease-1",
        "lease_owner": "offline-worker",
        "lease_expires_at_utc": NOW + timedelta(minutes=5),
        "heartbeat_at_utc": NOW - timedelta(seconds=10),
        "resource_checked_at_utc": NOW - timedelta(seconds=10),
        "data_observed_at_utc": NOW - timedelta(seconds=10),
    }
    values.update(overrides)
    return OwnerAbsencePolicy(**values)


def identity(token: str = "fence-1") -> SupervisorIdentity:
    return SupervisorIdentity(run_id="cli-run-1", fence_token=token)


def test_status_and_cold_start_are_json_and_never_ready_after_reboot(tmp_path) -> None:
    path = tmp_path / "owner-absence.jsonl"
    OwnerAbsenceHostSupervisor(path).tick(ready_policy(), identity(), now=NOW)

    output = StringIO()
    assert main(["status", "--journal", str(path)], stdout=output, stderr=StringIO()) == EXIT_OK
    status = json.loads(output.getvalue())
    assert status["state"] == "running"
    assert status["ready"] is False
    assert status["execution_capability"] is False

    output = StringIO()
    assert main(["cold-start", "--journal", str(path)], stdout=output, stderr=StringIO()) == EXIT_OK
    cold_start = json.loads(output.getvalue())
    assert cold_start["next_sequence"] == 2
    assert cold_start["ready"] is False


def test_verify_replays_integrity_without_host_boot_mutation(tmp_path) -> None:
    path = tmp_path / "owner-absence.jsonl"
    OwnerAbsenceHostSupervisor(path).tick(ready_policy(), identity(), now=NOW)

    output = StringIO()
    assert main(["verify", "--journal", str(path)], stdout=output, stderr=StringIO()) == EXIT_OK
    receipt = json.loads(output.getvalue())
    assert receipt["verified"] is True
    assert receipt["event_count"] == 1
    assert receipt["state"] == "running"
    assert receipt["execution_capability"] is False


def test_corrupt_journal_fails_closed_without_stdout(tmp_path) -> None:
    path = tmp_path / "owner-absence.jsonl"
    OwnerAbsenceHostSupervisor(path).tick(ready_policy(), identity(), now=NOW)
    path.write_bytes(path.read_bytes().rstrip(b"\n"))

    output = StringIO()
    errors = StringIO()
    assert main(["verify", "--journal", str(path)], stdout=output, stderr=errors) == EXIT_UNTRUSTED
    assert output.getvalue() == ""
    assert "untrusted journal" in errors.getvalue()
