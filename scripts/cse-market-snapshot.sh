#!/usr/bin/env bash
# CSE-110: capture one authenticated, opt-in CSE market snapshot.
#
# The API stores the normalized snapshot locally and deduplicates by trade day.
# A failed upstream request is reported as a failed scheduler run so operators
# can distinguish a stale history from a fresh capture.

set -euo pipefail

BASE_URL="${FINANCE_BASE_URL:-http://127.0.0.1:3000}"
curl_config=$(mktemp)
response_file=$(mktemp)
trap 'rm -f "$curl_config" "$response_file"' EXIT
chmod 600 "$curl_config"

curl_args=()
if [[ -n "${FINANCE_SESSION_COOKIE:-}" ]]; then
  printf 'header = "Cookie: %s"\n' "$FINANCE_SESSION_COOKIE" > "$curl_config"
  curl_args=(--config "$curl_config")
fi

status=$(curl --connect-timeout 5 --max-time 30 -sS -o "$response_file" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  "${curl_args[@]}" \
  -d '{}' \
  "${BASE_URL%/}/api/cse-market")

case "$status" in
  200)
    echo "CSE market snapshot captured."
    ;;
  502)
    echo "CSE market snapshot unavailable upstream." >&2
    exit 1
    ;;
  *)
    echo "CSE market snapshot failed (HTTP $status)." >&2
    exit 1
    ;;
esac
