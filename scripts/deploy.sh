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
#   --quiet-if-unchanged   Exit 0 with no output if already at origin/main's
#                           HEAD (skips install/build/restart entirely).
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

if [ -n "$(git status --porcelain)" ]; then
  echo "error: deploy directory has uncommitted changes — this directory should only ever hold a clean checkout of origin/main." >&2
  git status --short >&2
  exit 1
fi

git fetch origin main --quiet

CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse origin/main)
if [ "$CURRENT" = "$TARGET" ]; then
  if [ "$QUIET_IF_UNCHANGED" = "1" ]; then
    exit 0
  fi
  echo "==> already up to date at $CURRENT"
  exit 0
fi

echo "==> updating $CURRENT -> $TARGET"
git merge --ff-only origin/main

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> pnpm build"
pnpm build

echo "==> restarting hermes-workspace.service (requires sudo)"
sudo systemctl restart hermes-workspace

echo "==> waiting for health check"
for i in $(seq 1 15); do
  if curl -sf -o /dev/null http://127.0.0.1:3000/; then
    echo "==> deployed $(git rev-parse --short HEAD), service healthy"
    exit 0
  fi
  sleep 1
done

echo "error: service did not become healthy within 15s after restart" >&2
sudo systemctl status hermes-workspace --no-pager >&2
exit 1
