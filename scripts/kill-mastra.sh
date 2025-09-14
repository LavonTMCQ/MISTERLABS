#!/usr/bin/env bash
set -euo pipefail

echo "Scanning for Mastra servers and ports (4111-4114)..."

PORTS=(4111 4112 4113 4114)
for p in "${PORTS[@]}"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Killing processes on port $p..."
    # TERM first
    lsof -tiTCP:"$p" -sTCP:LISTEN | xargs -I{} kill -TERM {} 2>/dev/null || true
    sleep 0.5
    # KILL if still present
    if lsof -tiTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      lsof -tiTCP:"$p" -sTCP:LISTEN | xargs -I{} kill -KILL {} 2>/dev/null || true
    fi
  fi
done

echo "Killing any 'mastra dev/start' processes..."
pkill -f "mastra dev" 2>/dev/null || true
pkill -f "mastra start" 2>/dev/null || true
pkill -f "@mastra/server" 2>/dev/null || true

echo "Verifying ports:"
for p in "${PORTS[@]}"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $p still in use:";
    lsof -nP -iTCP:"$p" -sTCP:LISTEN || true
  else
    echo "Port $p is free."
  fi
done

echo "Done."

