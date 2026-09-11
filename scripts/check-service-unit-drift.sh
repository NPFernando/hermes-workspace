#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-hermes-workspace}"
UNIT_SOURCE="${UNIT_SOURCE:-deploy/systemd/${SERVICE_NAME}.service}"

if [[ ! -f "$UNIT_SOURCE" ]]; then
  echo "error: expected unit template not found: $UNIT_SOURCE" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "::warning::systemctl is unavailable; service-unit drift was not checked"
  exit 0
fi

if ! systemctl show "$SERVICE_NAME" >/dev/null 2>&1; then
  echo "::warning::$SERVICE_NAME is not known to systemd; service-unit drift was not checked"
  exit 0
fi

fragment_path="$(systemctl show -p FragmentPath --value "$SERVICE_NAME")"
if [[ -z "$fragment_path" || ! -f "$fragment_path" ]]; then
  echo "::warning::$SERVICE_NAME has no readable systemd fragment"
  exit 0
fi

if cmp -s "$UNIT_SOURCE" "$fragment_path"; then
  echo "✅ $SERVICE_NAME unit matches $UNIT_SOURCE"
else
  echo "::warning::$SERVICE_NAME differs from $UNIT_SOURCE"
  diff -u "$UNIT_SOURCE" "$fragment_path" || true
fi

drop_ins="$(systemctl show -p DropInPaths --value "$SERVICE_NAME")"
if [[ -n "$drop_ins" ]]; then
  echo "::warning::$SERVICE_NAME has installed drop-ins: $drop_ins"
fi

echo "active unit: $fragment_path"
echo "working directory: $(systemctl show -p WorkingDirectory --value "$SERVICE_NAME")"
echo "exec start: $(systemctl show -p ExecStart --value "$SERVICE_NAME")"
