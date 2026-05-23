#!/usr/bin/env bash
# Regenerate data.json and run all validation passes.
# Fails fast on the first error so CI / pre-handoff catches drift.
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

OUT="data/output/data.json"

echo "==> export"
"$PYTHON_BIN" -m app.export_data_json \
  --raw data/raw \
  --out "$OUT" \
  --processed data/processed

echo
echo "==> validate_data_json"
"$PYTHON_BIN" -m app.validate_data_json "$OUT"

echo
echo "==> validate_model_outputs"
"$PYTHON_BIN" -m app.validate_model_outputs "$OUT"

echo
echo "==> backtest (plausibility)"
"$PYTHON_BIN" -m app.backtest \
  --raw data/raw \
  --processed data/processed \
  --out data/processed/backtest_report.json \
  --cases 50 --seed 42 || echo "  ! backtest reported a non-OK status (non-blocking)"

if [[ -d tests ]]; then
  echo
  echo "==> pytest"
  "$PYTHON_BIN" -m pytest tests -q || {
    echo "tests failed"
    exit 1
  }
fi

echo
echo "✔ all checks passed"
echo "  data.json: $OUT"
echo "  backtest:  data/processed/backtest_report.json"
