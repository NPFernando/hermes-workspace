#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load workspace configuration before deriving runtime settings or building.
# Services and non-interactive shells often do not export the .env values, which
# can leave the stable launcher without Hermes API/dashboard tokens or URLs.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

PORT="${PORT:-3002}"
RUNTIME_DIR="$ROOT/.runtime"
PID_FILE="$RUNTIME_DIR/hermes-workspace.pid"
LOG_FILE="$RUNTIME_DIR/hermes-workspace.log"
BUILD_LOG_FILE="$RUNTIME_DIR/hermes-workspace.build.log"
mkdir -p "$RUNTIME_DIR"

stop_pid() {
  local pid="$1"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        return 0
      fi
      sleep 0.25
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]]; then
    stop_pid "$old_pid"
  fi
  rm -f "$PID_FILE"
fi

for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  stop_pid "$pid"
done

echo "[stable] building Hermes Workspace..."
rm -rf dist
pnpm build >"$BUILD_LOG_FILE" 2>&1

echo "[stable] starting Hermes Workspace on port $PORT..."
nohup env PORT="$PORT" NODE_OPTIONS="--max-old-space-size=2048" node server-entry.js >>"$LOG_FILE" 2>&1 &
new_pid=$!
echo "$new_pid" >"$PID_FILE"
EXPECTED_BUILD="${HERMES_BUILD_ID:-}"
if [[ -z "$EXPECTED_BUILD" ]]; then
  EXPECTED_BUILD="$(sha256sum dist/server/server.js | cut -c1-16)"
fi

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:$PORT/chat/new" >/dev/null 2>&1; then
    if ! RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" \
      node scripts/release-smoke.mjs "http://127.0.0.1:$PORT" \
      >>"$LOG_FILE" 2>&1; then
      echo "[stable] release smoke failed; refusing to report a healthy service (see $LOG_FILE)" >&2
      stop_pid "$new_pid"
      rm -f "$PID_FILE"
      exit 1
    fi
    echo "[stable] up on http://127.0.0.1:$PORT/chat/new"
    echo "[stable] pid=$new_pid"
    echo "[stable] log=$LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$new_pid" 2>/dev/null; then
    echo "[stable] failed to start, see $LOG_FILE and $BUILD_LOG_FILE" >&2
    exit 1
  fi
  sleep 0.25
done

echo "[stable] timed out waiting for startup, see $LOG_FILE" >&2
exit 1
