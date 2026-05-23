#!/usr/bin/env bash
# Generate data/output/data.json from the Excel exports in data/raw/.
# Usage:
#   ./scripts/run_export.sh [extra args forwarded to app.export_data_json]
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

"$PYTHON_BIN" -m app.export_data_json \
  --raw data/raw \
  --out data/output/data.json \
  --processed data/processed \
  "$@"
