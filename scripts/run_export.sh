#!/usr/bin/env bash
# Generate data/output/data.json from the Excel exports in data/raw/.
# If linewise/ is present, also refresh linewise/data/plan.json so the
# Vite dev middleware picks up the new payload on the next browser load.
#
# Usage:
#   ./scripts/run_export.sh [extra args forwarded to app.export_data_json]
#   SKIP_FRONTEND_SYNC=1 ./scripts/run_export.sh   # skip the sync step
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

if [[ -d linewise && -z "${SKIP_FRONTEND_SYNC:-}" ]]; then
  echo
  echo "→ syncing frontend plan.json"
  "$PYTHON_BIN" -m app.frontend_payload \
    --in data/output/data.json \
    --out linewise/data/plan.json
fi
