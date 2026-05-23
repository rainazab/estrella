#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

"$PYTHON_BIN" -m app.export_data_json
"$PYTHON_BIN" -m app.validate_data_json ../frontend/public/data.json
"$PYTHON_BIN" -m app.validate_model_outputs ../frontend/public/data.json
