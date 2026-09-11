#!/usr/bin/env bash
# AUTO-200: queue the opt-in, approval-gated daily finance check.
#
# The API remains authoritative for authentication, opt-in policy, duplicate
# protection, and awaiting-approval status. A disabled policy or an existing
# check for today is an intentional scheduler no-op.
#
# Usage:
#   FINANCE_BASE_URL=http://127.0.0.1:3000 ./scripts/daily-finance-check.sh

set -euo pipefail

umask 077
BASE_URL="${FINANCE_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${FINANCE_DAILY_CHECK_LOG_DIR:-${HOME}/.hermes/finance/daily-check-logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date -u +%Y-%m-%d).jsonl"

curl_args=()
curl_config=$(mktemp)
chmod 600 "$curl_config"
if [[ -n "${FINANCE_SESSION_COOKIE:-}" ]]; then
  printf 'header = "Cookie: %s"\n' "$FINANCE_SESSION_COOKIE" > "$curl_config"
  curl_args=(--config "$curl_config")
fi

response_file=$(mktemp)
trap 'rm -f "$response_file" "$curl_config"' EXIT

status=$(curl --connect-timeout 5 --max-time 30 -sS -o "$response_file" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  "${curl_args[@]}" \
  -d '{"action":"queue_proactive_finance_review","responseMode":"scheduler_ack"}' \
  "${BASE_URL%/}/api/finance")
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ "$status" == "200" ]]; then
  printf '{"at":"%s","httpStatus":%s,"result":"queued"}\n' \
    "$timestamp" "$status" >> "$LOG_FILE"
else
  printf '{"at":"%s","httpStatus":%s,"result":"skipped_or_failed"}\n' \
    "$timestamp" "$status" >> "$LOG_FILE"
fi

case "$status" in
  200|403|409)
    echo "daily finance check completed (HTTP $status)."
    ;;
  *)
    echo "daily finance check failed (HTTP $status)." >&2
    exit 1
    ;;
esac
