#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
LOG_DIR="$ROOT_DIR/.mastra"
LOG_FILE="$LOG_DIR/dev-4111.log"

mkdir -p "$LOG_DIR"

echo "==> Cleaning any existing Mastra servers on 4111-4114"
bash "$ROOT_DIR/scripts/kill-mastra.sh"

echo "==> Starting Mastra dev on :4111 (logs -> $LOG_FILE)"
export PORT=4111
exec mastra dev 2>&1 | tee "$LOG_FILE"

