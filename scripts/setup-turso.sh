#!/usr/bin/env bash
set -euo pipefail

# Quick setup for Turso LibSQL memory store
# - Creates (or reuses) a DB
# - Mints a DB auth token
# - Prints MEMORY_ env vars for Mastra Cloud

DB_NAME="${1:-mister-memory}"

echo "==> Using database name: ${DB_NAME}"

# Ensure Turso CLI is available
if ! command -v turso >/dev/null 2>&1; then
  echo "==> Turso CLI not found; installing to ~/.turso"
  curl -sSfL https://get.tur.so/install.sh | sh
  # shellcheck disable=SC1090
  [ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" || true
fi

if ! command -v turso >/dev/null 2>&1; then
  echo "ERROR: Turso CLI still not on PATH. Add \"export PATH=$HOME/.turso:$PATH\" to your shell and retry." >&2
  exit 1
fi

# Require a logged-in session
if ! turso auth whoami >/dev/null 2>&1; then
  echo "ERROR: Not logged in to Turso. Run: turso auth login --headless" >&2
  exit 1
fi

echo "==> Ensuring database exists"
if ! turso db show "${DB_NAME}" --url >/dev/null 2>&1; then
  turso db create "${DB_NAME}"
fi

echo "==> Fetching database URL"
DB_URL=$(turso db show "${DB_NAME}" --url | tr -d ' \n')

echo "==> Creating database token"
DB_TOKEN=$(turso db tokens create "${DB_NAME}" | tail -n1 | tr -d ' \n')

echo "\n==> Add these to your Mastra Cloud env:\n"
echo "MEMORY_DATABASE_URL=${DB_URL}"
echo "MEMORY_DATABASE_AUTH_TOKEN=${DB_TOKEN}"
echo "\nDone."

