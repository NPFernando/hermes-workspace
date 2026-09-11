#!/usr/bin/env bash
# AN-103 / AUTO-203: capture one idempotent net-worth snapshot for the month.
#
# This is intentionally a thin host-scheduler entrypoint. The API remains
# authoritative for authentication, date validation, duplicate protection,
# Postgres-primary persistence, and the snapshot calculation. No cron or
# systemd registration is installed by this script.
#
# Usage:
#   FINANCE_BASE_URL=http://127.0.0.1:3000 ./scripts/monthly-net-worth-snapshot.sh
#   FINANCE_SNAPSHOT_DATE=2026-09-10 ./scripts/monthly-net-worth-snapshot.sh

set -euo pipefail

umask 077
BASE_URL="${FINANCE_BASE_URL:-http://127.0.0.1:3000}"
SNAPSHOT_DATE="${FINANCE_SNAPSHOT_DATE:-$(date -u +%Y-%m-%d)}"
LOG_DIR="${FINANCE_SNAPSHOT_LOG_DIR:-${HOME}/.hermes/finance/net-worth-snapshot-logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${SNAPSHOT_DATE}.jsonl"

if [[ ! "$SNAPSHOT_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "FINANCE_SNAPSHOT_DATE must be YYYY-MM-DD" >&2
  exit 2
fi

curl_args=()
curl_config=$(mktemp)
chmod 600 "$curl_config"
if [[ -n "${FINANCE_SESSION_COOKIE:-}" ]]; then
  printf 'header = "Cookie: %s"\n' "$FINANCE_SESSION_COOKIE" > "$curl_config"
  curl_args=(--config "$curl_config")
fi
trap 'rm -f "$response_file" "$curl_config"' EXIT

response_file=$(mktemp)

status=$(curl --connect-timeout 5 --max-time 30 -sS -o "$response_file" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X POST \
  -d "{\"action\":\"capture_net_worth_snapshot\",\"snapshotDate\":\"${SNAPSHOT_DATE}\",\"source\":\"scheduled\"}" \
  "${curl_args[@]}" \
  "${BASE_URL%/}/api/finance")
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ "$status" == "200" ]]; then
  printf '{"at":"%s","snapshotDate":"%s","httpStatus":%s}\n' \
    "$timestamp" "$SNAPSHOT_DATE" "$status" >> "$LOG_FILE"
  echo "Net-worth snapshot captured for ${SNAPSHOT_DATE}."
  exit 0
fi

printf '{"at":"%s","snapshotDate":"%s","httpStatus":%s,"error":true}\n' \
  "$timestamp" "$SNAPSHOT_DATE" "$status" >> "$LOG_FILE"
echo "net-worth snapshot failed (HTTP $status)." >&2
exit 1
