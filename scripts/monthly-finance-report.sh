#!/usr/bin/env bash
# AUTO-202: download the authenticated, read-only monthly finance report.
#
# The API uses the current authenticated/local finance store and never mutates
# records. Set FINANCE_SESSION_COOKIE when password protection is enabled.
#
# Usage:
#   FINANCE_BASE_URL=http://127.0.0.1:3000 ./scripts/monthly-finance-report.sh

set -euo pipefail

umask 077
BASE_URL="${FINANCE_BASE_URL:-http://127.0.0.1:3000}"
MONTH="${FINANCE_REPORT_MONTH:-$(date -u +%Y-%m)}"
OUTPUT_DIR="${FINANCE_REPORT_DIR:-${HOME}/.hermes/finance/monthly-reports}"
mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="$OUTPUT_DIR/finance-report-${MONTH}.md"

curl_args=()
curl_config=$(mktemp)
chmod 600 "$curl_config"
if [[ -n "${FINANCE_SESSION_COOKIE:-}" ]]; then
  printf 'header = "Cookie: %s"\n' "$FINANCE_SESSION_COOKIE" > "$curl_config"
  curl_args=(--config "$curl_config")
fi
trap 'rm -f "$curl_config"' EXIT

status=$(curl --connect-timeout 5 --max-time 30 -sS -o "$OUTPUT_FILE" -w '%{http_code}' \
  "${curl_args[@]}" \
  "${BASE_URL%/}/api/finance?scope=personal_finance&format=monthly-report&month=${MONTH}")

if [[ "$status" != "200" ]]; then
  rm -f "$OUTPUT_FILE"
  echo "monthly finance report failed (HTTP $status)" >&2
  exit 1
fi

echo "$OUTPUT_FILE"
