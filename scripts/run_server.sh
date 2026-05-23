#!/usr/bin/env bash
# Start the LineWise HTTP API on localhost:8000.
# Usage:
#   ./scripts/run_server.sh                 # default host/port
#   ./scripts/run_server.sh --reload        # auto-reload for local dev
#   LINEWISE_HOST=0.0.0.0 LINEWISE_PORT=9000 ./scripts/run_server.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

"$PYTHON_BIN" -m app.server \
  --data data/output/data.json \
  "$@"
