#!/usr/bin/env bash
# Start the Odysseus companion service (bound to loopback only, no auth)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ODYSSEUS_DIR="$SCRIPT_DIR/../services/odysseus"

# Reuse a separately managed companion when it is already healthy. This keeps
# `start:all` quiet and avoids requiring a local venv for a shared service.
if curl --silent --fail --max-time 2 http://127.0.0.1:7100/api/health >/dev/null 2>&1; then
  echo "[odysseus] Already running — reusing existing process"
  exit 0
fi

if [ ! -d "$ODYSSEUS_DIR/venv" ]; then
  echo "[odysseus] venv not found — run: cd $ODYSSEUS_DIR && python3 -m venv venv && venv/bin/pip install -r requirements.txt"
  exit 1
fi

mkdir -p "$ODYSSEUS_DIR/data"
cd "$ODYSSEUS_DIR"

# shellcheck disable=SC1091
source venv/bin/activate
exec uvicorn app:app --host 127.0.0.1 --port 7100
