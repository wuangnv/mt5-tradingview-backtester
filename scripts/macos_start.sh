#!/bin/bash

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$PROJECT_ROOT/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"
REQUIREMENTS="$PROJECT_ROOT/requirements.txt"
APP_FILE="$PROJECT_ROOT/app.py"
CHARTING_LIBRARY="$PROJECT_ROOT/static/charting_library/charting_library.standalone.js"
URL="http://127.0.0.1:5000"

step() {
    echo
    echo "==> $1"
}

find_python() {
    if command -v python3 >/dev/null 2>&1; then
        echo "python3"
        return
    fi

    if command -v python >/dev/null 2>&1; then
        echo "python"
        return
    fi

    echo "Python 3 was not found. Install Python 3.8+ from https://www.python.org/downloads/macos/" >&2
    exit 1
}

if [ ! -f "$APP_FILE" ]; then
    echo "app.py was not found. Please keep this launcher inside the project root."
    exit 1
fi

if [ ! -f "$CHARTING_LIBRARY" ]; then
    echo
    echo "Warning: TradingView charting library was not found:"
    echo "  $CHARTING_LIBRARY"
    echo "The server can start, but the chart will not load until the licensed TradingView files are placed there."
fi

PYTHON_BIN="$(find_python)"

if [ ! -x "$VENV_PYTHON" ]; then
    step "Creating local Python virtual environment"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

step "Upgrading pip"
"$VENV_PYTHON" -m pip install --upgrade pip

step "Installing Python dependencies"
"$VENV_PYTHON" -m pip install -r "$REQUIREMENTS"

step "Starting local web app"
echo "Browser will open at $URL when the server is ready."
echo "Keep this Terminal window open while using the app."
echo "Use the red power button in the app or press Ctrl+C here to stop."
echo

(
    for _ in $(seq 1 90); do
        if curl -fsS "$URL" >/dev/null 2>&1; then
            open "$URL" >/dev/null 2>&1 || true
            exit 0
        fi
        sleep 1
    done
) &

cd "$PROJECT_ROOT"
"$VENV_PYTHON" "$APP_FILE"
