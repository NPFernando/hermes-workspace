#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-hermes-workspace}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8642}"
ODYSSEUS_URL="${ODYSSEUS_URL:-http://127.0.0.1:7100}"

EXPECTED_BUILD=""
if [[ -f dist/server/server.js ]]; then
  EXPECTED_BUILD="${HERMES_BUILD_ID:-}"
  if [[ -n "$EXPECTED_BUILD" ]]; then
    EXPECTED_BUILD="$(printf '%s' "$EXPECTED_BUILD" | tr -cd 'a-zA-Z0-9._-' | cut -c1-32)"
  fi
  if [[ -z "$EXPECTED_BUILD" ]]; then
    EXPECTED_BUILD="$(sha256sum dist/server/server.js | cut -c1-16)"
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active --quiet "$SERVICE_NAME" || {
    echo "error: $SERVICE_NAME is not active" >&2
    exit 1
  }
  pid="$(systemctl show -p MainPID --value "$SERVICE_NAME")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" -gt 0 ]]; then
    echo "service=$SERVICE_NAME pid=$pid started=$(ps -o lstart= -p "$pid" | sed 's/^ *//')"
  fi
fi

curl --fail --silent --show-error "$BASE_URL/api/health" >/dev/null
curl --fail --silent --show-error "$GATEWAY_URL/health" >/dev/null
curl --fail --silent --show-error "$ODYSSEUS_URL/api/health" >/dev/null
if [[ -n "$EXPECTED_BUILD" ]]; then
  set +e
  RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" \
    node scripts/release-smoke.mjs "$BASE_URL"
  smoke_status=$?
  set -e
else
  set +e
  node scripts/release-smoke.mjs "$BASE_URL"
  smoke_status=$?
  set -e
fi
if [[ "$smoke_status" -ne 0 ]]; then
  echo "error: live release smoke failed" >&2
  if [[ -n "$EXPECTED_BUILD" ]]; then
    echo "diagnostic: expected local build=$EXPECTED_BUILD" >&2
    echo "diagnostic: missing x-workspace-build or security headers usually means the active service is serving an older artifact" >&2
  fi
  if command -v systemctl >/dev/null 2>&1; then
    unit_path="$(systemctl show -p FragmentPath --value "$SERVICE_NAME" 2>/dev/null || true)"
    exec_start="$(systemctl show -p ExecStart --value "$SERVICE_NAME" 2>/dev/null || true)"
    [[ -n "$unit_path" ]] && echo "diagnostic: unit=$unit_path" >&2
    [[ -n "$exec_start" ]] && echo "diagnostic: exec=$exec_start" >&2
  fi
  exit "$smoke_status"
fi
echo "✅ live deployment healthy"
