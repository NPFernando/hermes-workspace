#!/usr/bin/env bash
set -euo pipefail

# Interactive, operator-run setup. Secrets are read without echo, never put in
# argv, and written only to the protected Hermes environment file.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_HOME_DIR="${HERMES_HOME:-/home/ubuntu/.hermes}"
ENV_FILE="$HERMES_HOME_DIR/.env"
UNIT_DIR="/etc/systemd/system"

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is required. Install it and configure a remote with: rclone config" >&2
  exit 1
fi

read -r -p 'Existing rclone remote/path (for example b2:hermes-finance): ' remote
if [[ ! "$remote" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*:.+$ || "$remote" =~ [[:space:]] ]]; then
  echo 'Refusing invalid rclone remote; use a configured remote such as b2:hermes-finance.' >&2
  exit 1
fi
if [[ "$remote" =~ ^local: ]]; then
  echo 'Refusing the rclone local backend; Finance backups must be off-site.' >&2
  exit 1
fi
if ! rclone lsd "$remote" >/dev/null; then
  echo "rclone could not access $remote; no configuration was changed." >&2
  exit 1
fi

read -r -s -p 'New Finance backup passphrase (12+ characters): ' passphrase
printf '\n' >&2
read -r -s -p 'Repeat Finance backup passphrase: ' confirmation
printf '\n' >&2
if [[ ${#passphrase} -lt 12 || "$passphrase" != "$confirmation" || "$passphrase" == *$'\n'* || "$passphrase" == *$'\r'* || "$passphrase" == *'"'* || "$passphrase" == *'\\'* ]]; then
  echo 'Passphrases must match and contain at least 12 characters; no configuration was changed.' >&2
  exit 1
fi

mkdir -p "$HERMES_HOME_DIR"
chmod 700 "$HERMES_HOME_DIR"
temporary="$(mktemp "$HERMES_HOME_DIR/.env.backup-setup.XXXXXX")"
cleanup() { rm -f "$temporary"; unset passphrase confirmation; }
trap cleanup EXIT
if [[ -f "$ENV_FILE" ]]; then
  grep -vE '^(HERMES_FINANCE_BACKUP_PASSPHRASE|HERMES_FINANCE_BACKUP_RCLONE_REMOTE)=' "$ENV_FILE" >"$temporary" || true
fi
printf 'HERMES_FINANCE_BACKUP_PASSPHRASE="%s"\n' "$passphrase" >>"$temporary"
printf 'HERMES_FINANCE_BACKUP_RCLONE_REMOTE="%s"\n' "$remote" >>"$temporary"
chmod 600 "$temporary"
mv -f "$temporary" "$ENV_FILE"
trap - EXIT
unset passphrase confirmation

echo 'Configuration staged. Running one encrypted round-trip verification before enabling the timer...'
HERMES_HOME="$HERMES_HOME_DIR" pnpm --dir "$ROOT_DIR" run finance:offsite-backup

sudo install -m 0644 "$ROOT_DIR/deploy/systemd/hermes-finance-offsite-backup.service" "$UNIT_DIR/"
sudo install -m 0644 "$ROOT_DIR/deploy/systemd/hermes-finance-offsite-backup.timer" "$UNIT_DIR/"
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-finance-offsite-backup.timer
echo 'Finance off-site backup setup and verification completed.'
