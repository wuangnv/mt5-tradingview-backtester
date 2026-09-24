"""Rebuild the local workspace in an isolated Windows-friendly layout and smoke it."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import venv
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parents[1]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def python_in_venv(venv_root):
    if os.name == "nt":
        return Path(venv_root) / "Scripts" / "python.exe"
    return Path(venv_root) / "bin" / "python"


def copy_fixture_layout(target_root):
    workspace = Path(target_root) / "TradingWorkspace"
    project = workspace / "projects" / PROJECT_ROOT.name
    education = workspace / "education"

    ignore = shutil.ignore_patterns(
        ".git",
        ".venv",
        "data",
        "__pycache__",
        "*.pyc",
        ".pytest_cache",
    )
    shutil.copytree(PROJECT_ROOT, project, ignore=ignore)
    education.mkdir(parents=True, exist_ok=True)
    for relative in (
        "course.json",
        "progress.json",
        "COURSE.md",
        "reference.md",
        "practice/workbook.md",
    ):
        source = WORKSPACE_ROOT / "education" / relative
        destination = education / relative
        if source.is_file():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    return workspace, project


def run_smoke(project, temp_root):
    venv_root = Path(temp_root) / "clean-venv"
    venv.EnvBuilder(with_pip=True, clear=True).create(venv_root)
    python = python_in_venv(venv_root)
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            str(project / "requirements.txt"),
        ],
        cwd=project,
        check=True,
    )

    data_root = Path(temp_root) / "runtime-data"
    code = r'''
import json
import os
from pathlib import Path

from demo_broker import DemoBrokerSimulator
from workspace_app import create_app

root = Path(os.environ["PORTABILITY_DATA_ROOT"])
app = create_app(root, demo_adapter=DemoBrokerSimulator())
app.config["TESTING"] = True
client = app.test_client()

status_response = client.get("/api/workspace/status")
learn_response = client.get("/api/learn/overview")
execution_response = client.get("/api/execution/state")
assert status_response.status_code == 200
assert learn_response.status_code == 200
assert execution_response.status_code == 200

workspace = status_response.get_json()["workspace"]
execution = execution_response.get_json()["state"]
assert workspace["acceptance"]["full_product_complete"] is False
assert execution["live_execution_enabled"] is False
assert execution["adapter"] == "local-simulator"

print(json.dumps({
    "workspace_status_http": status_response.status_code,
    "learn_overview_http": learn_response.status_code,
    "execution_state_http": execution_response.status_code,
    "live_execution_enabled": execution["live_execution_enabled"],
    "execution_adapter": execution["adapter"],
    "full_product_complete": workspace["acceptance"]["full_product_complete"],
}, sort_keys=True))
'''
    environment = dict(os.environ)
    for name in (
        "EDUCATION_ROOT",
        "EVIDENCE_DB_PATH",
        "RESEARCH_DB_PATH",
        "JOURNAL_DB_PATH",
        "HISTORY_CHUNKS_PATH",
        "EXECUTION_DB_PATH",
        "CHART_DB_PATH",
        "P4_EXECUTION_BACKEND",
    ):
        environment.pop(name, None)
    environment["PORTABILITY_DATA_ROOT"] = str(data_root)
    completed = subprocess.run(
        [str(python), "-c", code],
        cwd=project,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout.strip().splitlines()[-1])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--temp-parent", default=str(WORKSPACE_ROOT / ".tmp"))
    parser.add_argument("--receipt")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    temp_parent = Path(args.temp_parent)
    temp_parent.mkdir(parents=True, exist_ok=True)
    temp_root = Path(tempfile.mkdtemp(prefix="mt5-portability-", dir=temp_parent))
    try:
        _, project = copy_fixture_layout(temp_root)
        checks = run_smoke(project, temp_root)
        receipt = {
            "schema_version": "portability-smoke-v1",
            "platform": sys.platform,
            "python": sys.version.split()[0],
            "requirements_sha256": sha256(PROJECT_ROOT / "requirements.txt"),
            "isolated_venv": True,
            "copied_project_layout": "TradingWorkspace/projects/mt5-tradingview-backtester",
            "copied_education_owner": True,
            "mt5_connection_attempted": False,
            "checks": checks,
        }
        if args.receipt:
            receipt_path = Path(args.receipt)
            receipt_path.parent.mkdir(parents=True, exist_ok=True)
            receipt_path.write_text(
                json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
        print(json.dumps(receipt, indent=2, sort_keys=True))
    finally:
        if args.keep:
            print(f"kept_temp_root={temp_root}")
        else:
            shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
