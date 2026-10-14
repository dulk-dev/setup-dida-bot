#!/usr/bin/env bash
# Ensure setup-dida-bot daemon is running. Safe to run repeatedly.
#
# Exit codes / stdout:
#   0  already_running  — pidfile points at a live process
#   0  started          — daemon was launched (or pidfile recovered)
#   1  failed           — missing config, start timed out, etc.
#
# Node on PATH: optionally set SETUP_DIDA_NODE_BIN to a directory containing
# `node`/`npm` (prepended to PATH). Do not hardcode a private Node install path.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data"
PIDFILE="$DATA/daemon.pid"
LOG="$DATA/daemon.log"
cd "$ROOT"

if [[ -n "${SETUP_DIDA_NODE_BIN:-}" ]]; then
  export PATH="${SETUP_DIDA_NODE_BIN}:${PATH}"
fi
# Also honour a conventional user-local bin if present (no version pin).
if [[ -d "${HOME}/.local/bin" ]]; then
  export PATH="${HOME}/.local/bin:${PATH}"
fi

mkdir -p "$DATA"

is_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  if [[ -f "$PIDFILE" ]]; then
    tr -d ' \n' < "$PIDFILE" || true
  fi
}

PID="$(read_pid)"
if is_alive "$PID"; then
  echo "already_running pid=$PID"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found on PATH; set SETUP_DIDA_NODE_BIN to a directory with node/npm" >&2
  exit 1
fi

if [[ ! -d node_modules ]] || [[ ! -x node_modules/.bin/tsx ]]; then
  echo "installing dependencies..."
  npm install --no-fund --no-audit
fi

if [[ ! -f config.json ]]; then
  echo "missing config.json" >&2
  exit 1
fi

# stale pidfile
rm -f "$PIDFILE"

nohup ./node_modules/.bin/tsx src/cli.ts daemon >>"$LOG" 2>&1 &
NEW_PID=$!
# cli should rewrite pidfile; wait briefly
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.5
  PID="$(read_pid)"
  if is_alive "$PID"; then
    echo "started pid=$PID"
    exit 0
  fi
  if is_alive "$NEW_PID"; then
    echo "$NEW_PID" >"$PIDFILE"
    echo "started pid=$NEW_PID"
    exit 0
  fi
done

echo "failed to start daemon" >&2
exit 1
