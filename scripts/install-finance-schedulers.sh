#!/usr/bin/env bash
# Install the versioned Personal Finance systemd units.
#
# The default mode is a read-only template check. Use --check-live to verify
# that the currently deployed checkout contains every referenced runtime
# script. Use --install to copy units and --enable to also enable/start their
# timers. This keeps adding scheduler configuration separate from actually
# activating production jobs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SOURCE="$REPO_ROOT/deploy/systemd"
UNIT_TARGET="/etc/systemd/system"
LIVE_ROOT="${FINANCE_LIVE_ROOT:-/home/ubuntu/hermes-workspace-live}"

MODE="check"
if [[ "${1:-}" == "--install" ]]; then
  MODE="install"
elif [[ "${1:-}" == "--enable" ]]; then
  MODE="enable"
elif [[ "${1:-}" == "--check-live" ]]; then
  MODE="check-live"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--check-live|--install|--enable]" >&2
  exit 2
fi

units=(
  hermes-finance-daily-check.service
  hermes-finance-daily-check.timer
  hermes-finance-monthly-report.service
  hermes-finance-monthly-report.timer
  hermes-finance-monthly-snapshot.service
  hermes-finance-monthly-snapshot.timer
  hermes-finance-cse-market-snapshot.service
  hermes-finance-cse-market-snapshot.timer
)
timers=(
  hermes-finance-daily-check.timer
  hermes-finance-monthly-report.timer
  hermes-finance-monthly-snapshot.timer
  hermes-finance-cse-market-snapshot.timer
)

for unit in "${units[@]}"; do
  [[ -r "$UNIT_SOURCE/$unit" ]] || {
    echo "error: missing unit template: $UNIT_SOURCE/$unit" >&2
    exit 1
  }
done

if [[ "$MODE" == "check" || "$MODE" == "check-live" ]]; then
  live_missing=0
  echo "finance scheduler templates: ok"
  echo "live checkout: $LIVE_ROOT"
  for script in daily-finance-check.sh monthly-finance-report.sh monthly-net-worth-snapshot.sh cse-market-snapshot.sh; do
    if [[ -x "$LIVE_ROOT/scripts/$script" ]]; then
      echo "runtime script: $script (present)"
    else
      echo "runtime script: $script (not present in live checkout; deploy code first)"
      live_missing=1
    fi
  done
  scheduler_env_file="${FINANCE_SCHEDULER_ENV_FILE:-$LIVE_ROOT/.env.finance-scheduler}"
  if [[ -e "$scheduler_env_file" || -L "$scheduler_env_file" ]]; then
    if [[ ! -f "$scheduler_env_file" || -L "$scheduler_env_file" ]]; then
      echo "scheduler env file: not a regular non-symlink file ($scheduler_env_file)"
      live_missing=1
    else
      mode="$(stat -c '%a' "$scheduler_env_file" 2>/dev/null || true)"
      if [[ ! "$mode" =~ ^[0-7]{3,4}$ ]] || (( 8#$mode & 077 )); then
        echo "scheduler env file: permissions must not grant group/other access ($scheduler_env_file)"
        live_missing=1
      else
        echo "scheduler env file: secure permissions"
      fi
    fi
  else
    echo "scheduler env file: not present (optional; scheduler requests will use local auth defaults)"
  fi
  if [[ "$MODE" == "check-live" && "$live_missing" -ne 0 ]]; then
    echo "live scheduler check: not ready" >&2
    exit 1
  fi
  if [[ "$MODE" == "check-live" ]]; then
    echo "live scheduler check: ready"
  fi
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "error: --$MODE requires root; default check mode is non-mutating" >&2
  exit 1
fi

for unit in "${units[@]}"; do
  install -m 0644 "$UNIT_SOURCE/$unit" "$UNIT_TARGET/$unit"
done
systemctl daemon-reload
echo "installed ${#units[@]} finance scheduler units"

if [[ "$MODE" == "enable" ]]; then
  for timer in "${timers[@]}"; do
    systemctl enable --now "$timer"
  done
  echo "enabled and started ${#timers[@]} finance scheduler timers"
else
  echo "timers remain disabled; run $0 --enable after reviewing policy and authentication"
fi
