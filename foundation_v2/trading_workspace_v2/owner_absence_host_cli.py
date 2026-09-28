"""Inspection-only CLI for the offline owner-absence host seam.

The reducer and journal are deliberately not a process manager.  This module
provides a small, scriptable read boundary for cold-start checks and operator
inspection without adding a command that can start, restart, tick, or grant
execution capability.  A corrupt or busy journal is reported on stderr and
returns a non-zero exit code; the CLI never repairs or truncates it.

Usage (from ``foundation_v2``)::

    python -m trading_workspace_v2.owner_absence_host_cli status --journal path
    python -m trading_workspace_v2.owner_absence_host_cli cold-start --journal path
    python -m trading_workspace_v2.owner_absence_host_cli verify --journal path

All successful output is one deterministic JSON object on stdout.  ``status``
and ``cold-start`` use the host boundary, so a persisted running attempt is
reported ``ready=false`` until a new fence is presented after this boot.  The
``verify`` command replays the journal without applying the host boot rule and
is useful for integrity checks in backup/restore scripts.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence, TextIO

from .owner_absence_host import OwnerAbsenceHostSupervisor
from .owner_absence_journal import OwnerAbsenceRunJournal


EXIT_OK = 0
EXIT_USAGE = 2
EXIT_UNTRUSTED = 3


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="owner-absence-host",
        description="Read-only owner-absence journal status and integrity checks.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("status", "cold-start", "verify"):
        command = commands.add_parser(name, help=f"{name.replace('-', ' ')} the journal")
        command.add_argument(
            "--journal",
            required=True,
            type=Path,
            help="path to the append-only owner-absence JSONL journal",
        )
    return parser


def _status_payload(status) -> dict[str, object]:
    # Pydantic's JSON mode makes datetime serialization explicit and keeps the
    # CLI contract aligned with the typed host status model.
    return status.model_dump(mode="json")


def _verify_payload(journal: OwnerAbsenceRunJournal) -> dict[str, object]:
    state = journal.load()
    snapshot = state.snapshot
    return {
        "schema_version": "owner-absence-host-verify-v1",
        "journal_path": str(journal.path),
        "verified": True,
        "event_count": len(state.events),
        "next_sequence": state.next_sequence,
        "last_event_hash": state.last_event_hash,
        "state": snapshot.state,
        "active_run_id": snapshot.active_run_id,
        "active_fence_token": snapshot.active_fence_token,
        "restart_count": snapshot.restart_count,
        "execution_capability": False,
    }


def _write_json(payload: dict[str, object], stream: TextIO) -> None:
    json.dump(payload, stream, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    stream.write("\n")


def main(
    argv: Sequence[str] | None = None,
    *,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
) -> int:
    """Run one read-only command and return a process-style exit code."""

    output = stdout or sys.stdout
    errors = stderr or sys.stderr
    try:
        args = _parser().parse_args(argv)
    except SystemExit as exc:
        # Preserve argparse's conventional 0/2 behaviour when called as a
        # function in tests while allowing ``python -m`` to exit naturally.
        return int(exc.code)

    journal = OwnerAbsenceRunJournal(args.journal)
    try:
        if args.command == "verify":
            payload = _verify_payload(journal)
        else:
            host = OwnerAbsenceHostSupervisor(journal.path)
            status = host.cold_start() if args.command == "cold-start" else host.status()
            payload = _status_payload(status)
    except Exception as exc:  # fail closed at the CLI boundary; no traceback/data leak
        print(f"owner-absence-host: untrusted journal: {exc}", file=errors)
        return EXIT_UNTRUSTED

    _write_json(payload, output)
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover - exercised through ``python -m`` smoke
    raise SystemExit(main())


__all__ = ["EXIT_OK", "EXIT_UNTRUSTED", "EXIT_USAGE", "main"]
