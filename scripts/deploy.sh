#!/usr/bin/env bash
# Deploys the current `main` branch to this directory and restarts the live
# hermes-workspace.service. This directory is the systemd deploy target
# (WorkingDirectory in /etc/systemd/system/hermes-workspace.service) —
# separate from a dev/editing working tree, which is never what's actually
# served on :3000. See the 2026-07-29 deploy-gap fix: before this, the
# service ran directly out of a dev tree that could be arbitrarily dirty,
# so merged main was never guaranteed to be live.
#
# Usage: ./scripts/deploy.sh [--quiet-if-unchanged]
#   --quiet-if-unchanged   Verify the live artifact and exit 0 with no output
#                           on a healthy unchanged checkout. Failed release
#                           smoke output is preserved for diagnostics. It skips
#                           install/build/restart, but still detects a stale
#                           process or checkout through release smoke.
#                           Used by hermes-workspace-deploy.timer for polling
#                           auto-deploy — polling (not a GitHub webhook) is
#                           deliberate: it needs no inbound trigger surface
#                           from GitHub Actions into this VM to secure.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

QUIET_IF_UNCHANGED=0
if [ "${1:-}" = "--quiet-if-unchanged" ]; then
  QUIET_IF_UNCHANGED=1
fi

artifact_build_id() {
  local configured="${HERMES_BUILD_ID:-}"
  if [[ -n "$configured" ]]; then
    configured="$(printf '%s' "$configured" | tr -cd 'a-zA-Z0-9._-' | cut -c1-32)"
    if [[ -n "$configured" ]]; then
      printf '%s' "$configured"
      return 0
    fi
  fi
  sha256sum dist/server/server.js | cut -c1-16
}

if [ -n "$(git status --porcelain)" ]; then
  echo "error: deploy directory has uncommitted changes — this directory should only ever hold a clean checkout of origin/main." >&2
  git status --short >&2
  exit 1
fi

git fetch origin main --quiet

CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse origin/main)
if [ "$CURRENT" = "$TARGET" ]; then
  if [[ ! -f dist/server/server.js ]]; then
    echo "error: checkout is at origin/main but dist/server/server.js is missing; cannot verify the running artifact." >&2
    exit 1
  fi
  EXPECTED_BUILD="$(artifact_build_id)"
  if [ "$QUIET_IF_UNCHANGED" = "1" ]; then
    smoke_log="$(mktemp)"
    trap 'rm -f "$smoke_log"' EXIT
    if ! RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" \
      node scripts/release-smoke.mjs http://127.0.0.1:3000 >"$smoke_log" 2>&1; then
      cat "$smoke_log" >&2
      echo "error: unchanged-check release smoke failed; the live process may be stale or serving a different artifact" >&2
      exit 1
    fi
    exit 0
  fi
  echo "==> already up to date at $CURRENT"
  RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" \
    node scripts/release-smoke.mjs http://127.0.0.1:3000
  exit 0
fi

echo "==> updating $CURRENT -> $TARGET"
git merge --ff-only origin/main

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> pnpm build"
pnpm build

# The server exposes a short artifact fingerprint so the post-restart smoke
# test can prove that systemd is serving this build, rather than an older
# process or checkout that happens to answer the health request. Keep this
# normalization aligned with server-entry.js: an unusable configured value
# falls back to the content hash.
EXPECTED_BUILD="$(artifact_build_id)"

echo "==> restarting hermes-workspace.service (requires sudo)"
OLD_PID="$(systemctl show -p MainPID --value hermes-workspace 2>/dev/null || true)"
sudo systemctl restart hermes-workspace

echo "==> waiting for health check"
for _ in $(seq 1 15); do
  if curl -sf -o /dev/null http://127.0.0.1:3000/; then
    NEW_PID="$(systemctl show -p MainPID --value hermes-workspace 2>/dev/null || true)"
    if [[ -n "$OLD_PID" && "$OLD_PID" != "0" && "$NEW_PID" == "$OLD_PID" ]]; then
      echo "error: health check passed but hermes-workspace PID did not change ($NEW_PID)" >&2
      exit 1
    fi
    RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" \
      node scripts/release-smoke.mjs http://127.0.0.1:3000
    echo "==> deployed $(git rev-parse --short HEAD), service healthy (pid=${NEW_PID:-unknown})"
    exit 0
  fi
  sleep 1
done

echo "error: service did not become healthy within 15s after restart" >&2
sudo systemctl status hermes-workspace --no-pager >&2
exit 1
