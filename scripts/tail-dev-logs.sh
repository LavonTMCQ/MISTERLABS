#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
LOG_FILE="$ROOT_DIR/.mastra/dev-4111.log"

if [ ! -f "$LOG_FILE" ]; then
  echo "Log file not found at $LOG_FILE"
  echo "Start the server with: pnpm run dev:tee"
  exit 1
fi

echo "Tailing $LOG_FILE (Ctrl-C to stop)"
tail -n 200 -f "$LOG_FILE"

