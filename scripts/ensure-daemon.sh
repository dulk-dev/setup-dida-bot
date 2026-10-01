#!/usr/bin/env bash
# 确保 setup-dida-bot daemon 在跑。可重复执行。
# 退出码：0 already_running | 0 started | 1 failed
#
# node / npm 必须在 PATH 上。不要在本脚本里写某台机器的 Node 绝对路径。
# 若调用处 PATH 更窄，可在 unit / cron 里自行前置 PATH（可选，不是本脚本的必需配置）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data"
PIDFILE="$DATA/daemon.pid"
LOG="$DATA/daemon.log"
cd "$ROOT"

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
# 进程自己不写 pidfile；短暂确认存活后由本脚本记下。
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
