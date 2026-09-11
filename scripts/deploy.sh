#!/usr/bin/env bash
# Deploys the current `main` branch to this directory and restarts the live
# hermes-workspace.service. This directory is the systemd deploy target
# (WorkingDirectory in /etc/systemd/system/hermes-workspace.service) —
# separate from a dev/editing working tree, which is never what's actually
# served on :3000. See the 2026-07-29 deploy-gap fix: before this, the
# service ran directly out of a dev tree that could be arbitrarily dirty,
# so merged main was never guaranteed to be live.
#
# Usage: ./scripts/deploy.sh [--quiet-if-unchanged] [--allow-local-ahead]
#   --quiet-if-unchanged   Verify the unchanged live artifact and exit quietly.
#   --allow-local-ahead    Explicitly allow a local HEAD ahead of origin/main.
#                           Used by hermes-workspace-deploy.timer for polling
#                           auto-deploy — polling (not a GitHub webhook) is
#                           deliberate: it needs no inbound trigger surface
#                           from GitHub Actions into this VM to secure.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

QUIET_IF_UNCHANGED=0
ALLOW_LOCAL_AHEAD=0
for arg in "$@"; do
  case "$arg" in
    --quiet-if-unchanged) QUIET_IF_UNCHANGED=1 ;;
    --allow-local-ahead) ALLOW_LOCAL_AHEAD=1 ;;
    *) echo "error: unknown option: $arg" >&2; exit 2 ;;
  esac
done

artifact_build_id() {
  local configured="${HERMES_BUILD_ID:-}"
  if [[ -n "$configured" ]]; then
    configured="$(printf '%s' "$configured" | tr -cd 'a-zA-Z0-9._-' | cut -c1-32)"
    if [[ -n "$configured" ]]; then printf '%s' "$configured"; return 0; fi
  fi
  sha256sum dist/server/server.js | cut -c1-16
}

if [ -n "$(git status --porcelain)" ]; then
  echo "error: deploy directory has uncommitted changes — refusing deployment." >&2
  git status --short >&2
  exit 1
fi

git fetch origin main --quiet

CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse origin/main)
if [ "$CURRENT" = "$TARGET" ]; then
  [ -f dist/server/server.js ] || { echo "error: build artifact is missing" >&2; exit 1; }
  EXPECTED_BUILD="$(artifact_build_id)"
  if [ "$QUIET_IF_UNCHANGED" = "1" ]; then
    RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" node scripts/release-smoke.mjs http://127.0.0.1:3000 >/dev/null
    exit 0
  fi
  echo "==> already up to date at $CURRENT"
  RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" node scripts/release-smoke.mjs http://127.0.0.1:3000
  exit 0
fi

echo "==> updating $CURRENT -> $TARGET"
if git merge-base --is-ancestor "$TARGET" "$CURRENT"; then
  if [ "$ALLOW_LOCAL_AHEAD" != "1" ]; then
    echo "error: local HEAD is ahead of origin/main; rerun explicitly with --allow-local-ahead" >&2
    exit 1
  fi
  echo "==> retaining explicitly approved local-ahead release"
else
  git merge --ff-only origin/main
fi

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> pnpm build"
pnpm build

EXPECTED_BUILD="$(artifact_build_id)"

OLD_PID="$(systemctl show -p MainPID --value hermes-workspace 2>/dev/null || true)"

echo "==> restarting hermes-workspace.service (requires sudo)"
sudo systemctl restart hermes-workspace

echo "==> waiting for health check"
for i in $(seq 1 15); do
  if curl -sf -o /dev/null http://127.0.0.1:3000/; then
    NEW_PID="$(systemctl show -p MainPID --value hermes-workspace 2>/dev/null || true)"
    if [[ -n "$OLD_PID" && "$OLD_PID" != "0" && "$NEW_PID" == "$OLD_PID" ]]; then
      echo "error: health check passed but service PID did not change ($NEW_PID)" >&2
      exit 1
    fi
    RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" node scripts/release-smoke.mjs http://127.0.0.1:3000
    echo "==> deployed $(git rev-parse --short HEAD), service healthy (pid=${NEW_PID:-unknown})"
    exit 0
  fi
  sleep 1
done

echo "error: service did not become healthy within 15s after restart" >&2
sudo systemctl status hermes-workspace --no-pager >&2
exit 1
