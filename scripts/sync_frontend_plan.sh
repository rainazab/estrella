#!/usr/bin/env bash
# Refresh the Vite fake-API seed at linewise/data/plan.json with whatever
# the Python backend currently has at data/output/data.json.
#
# Run this whenever you re-export or want the frontend's dev middleware
# to pick up new model output. The frontend's `usePlan` hook re-fetches
# /api/plan on reload, so a browser refresh is enough — no Vite restart.
#
# Usage:
#   ./scripts/sync_frontend_plan.sh                    # default in/out paths
#   ./scripts/sync_frontend_plan.sh --in <data.json> --out <plan.json>
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

"$PYTHON_BIN" -m app.frontend_payload \
  --in data/output/data.json \
  --out linewise/data/plan.json \
  "$@"
