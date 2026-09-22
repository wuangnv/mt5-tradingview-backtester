from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from limits import constrain_process, source_hash


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-hash", required=True)
    parser.add_argument("--memory-mb", type=int, required=True)
    args = parser.parse_args()
    constrain_process(args.memory_mb)
    if source_hash() != args.source_hash:
        raise RuntimeError("engine adapter source changed before process start")
    from adapter import execute_nautilus
    import platform
    import pyarrow
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    result = execute_nautilus(payload["rows"], payload["protocol"])
    result["runtime_identity"] = {
        "python": platform.python_version(),
        "pyarrow": pyarrow.__version__,
        "nautilus_trader": result["native_version"],
    }
    result["isolation"] = {"process_memory_limit_mb": args.memory_mb, "active_process_limit": 1, "mechanism": "Windows Job Object"}
    if source_hash() != args.source_hash:
        raise RuntimeError("engine adapter source changed during execution")
    if args.output.exists():
        raise RuntimeError("refusing to overwrite engine output")
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")
    os.replace(temporary, args.output)


if __name__ == "__main__":
    main()
