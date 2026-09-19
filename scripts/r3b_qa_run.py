"""Create an isolated, synthetic R3b QA run with complete provenance."""

import argparse
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from r3b_qa_fixture import build_r3b_qa_report
from session_store import SessionStore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True, help="Isolated workspace data directory")
    args = parser.parse_args()

    data_root = Path(args.data_root).resolve()
    data_root.mkdir(parents=True, exist_ok=True)
    store = SessionStore(data_root / "sessions.sqlite3")
    saved = store.save(build_r3b_qa_report())
    print(
        json.dumps(
            {
                "success": True,
                "qa_only": True,
                "run_id": str(saved["id"]),
                "closed_trades": saved["stats"]["trades"],
                "dataset_id": saved["evidence"]["data"]["dataset_id"],
                "data_root": str(data_root),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
