"""Create or restore a copy-only workspace backup."""

import argparse
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from workspace_storage import WorkspaceStorageError, backup_workspace, restore_workspace


def main(argv=None):
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    backup = subparsers.add_parser("backup")
    backup.add_argument("destination")
    backup.add_argument("--source", default=str(PROJECT_ROOT / "data"))

    restore = subparsers.add_parser("restore")
    restore.add_argument("source")
    restore.add_argument("destination")

    args = parser.parse_args(argv)
    try:
        if args.command == "backup":
            manifest = backup_workspace(args.source, args.destination)
        else:
            manifest = restore_workspace(args.source, args.destination)
    except WorkspaceStorageError as exc:
        parser.error(str(exc))
    print(json.dumps({"success": True, "manifest": manifest}, ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
