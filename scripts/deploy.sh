#!/usr/bin/env bash
# Deploys the current `main` branch to this directory and restarts the live
# hermes-workspace.service. This directory is the systemd deploy target
# (WorkingDirectory in /etc/systemd/system/hermes-workspace.service) —
# separate from a dev/editing working tree, which is never what's actually
# served on :3000. See the 2026-07-29 deploy-gap fix: before this, the
# service ran directly out of a dev tree that could be arbitrarily dirty,
# so merged main was never guaranteed to be live.
#
# Usage: ./scripts/deploy.sh [--quiet-if-unchanged] [--allow-local-ahead] [--preview]
#   --quiet-if-unchanged   Verify the unchanged live artifact and exit quietly.
#   --allow-local-ahead    Explicitly allow a local HEAD ahead of origin/main.
#                           Used by hermes-workspace-deploy.timer for polling
#                           auto-deploy — polling (not a GitHub webhook) is
#                           deliberate: it needs no inbound trigger surface
#                           from GitHub Actions into this VM to secure.
#   --preview               Fetch and report the proposed release without
#                           merging, building, restarting, or writing a marker.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

QUIET_IF_UNCHANGED=0
ALLOW_LOCAL_AHEAD=0
PREVIEW=0
for arg in "$@"; do
  case "$arg" in
    --quiet-if-unchanged) QUIET_IF_UNCHANGED=1 ;;
    --allow-local-ahead) ALLOW_LOCAL_AHEAD=1 ;;
    --preview) PREVIEW=1 ;;
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

RUNTIME_DIR="${HERMES_RUNTIME_STATE_DIR:-.runtime}"
BUILD_MARKER="$RUNTIME_DIR/build-commit"
PREVIOUS_DEPLOYMENT_COMMIT=""
if [ -f "$BUILD_MARKER" ]; then
  PREVIOUS_DEPLOYMENT_COMMIT="$(tr -d '\r\n' < "$BUILD_MARKER")"
fi
ROLLBACK_DIR=""
ROLLBACK_ACTIVE=0
DEPLOYMENT_CORRELATION_ID="${DEPLOYMENT_CORRELATION_ID:-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$$}"

record_deployment() {
  local journal="$RUNTIME_DIR/deployment-history.jsonl"
  local tmp="$journal.tmp"
  local at
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local commit
  commit="$(git rev-parse HEAD)"
  local repository_url="${DEPLOY_REPOSITORY_URL:-}"
  if [[ -z "$repository_url" ]]; then
    repository_url="$(git remote get-url origin 2>/dev/null || true)"
  fi
  repository_url="$(printf '%s' "$repository_url" | sed -E 's#^git@github\.com:#https://github.com/#; s#\.git$##')"
  local server_url="${GITHUB_SERVER_URL:-https://github.com}"
  local repository="${GITHUB_REPOSITORY:-}"
  if [[ -z "$repository" && "$repository_url" =~ ^https://github\.com/([^/]+/[^/]+)$ ]]; then
    repository="${BASH_REMATCH[1]}"
  fi
  local commit_url=""
  local checks_url="${DEPLOY_CHECKS_URL:-}"
  local deployment_url="${DEPLOYMENT_URL:-}"
  if [[ -n "$repository" ]]; then
    commit_url="${repository_url:-$server_url/$repository}/commit/$commit"
    if [[ -z "$checks_url" && -n "${GITHUB_RUN_ID:-}" ]]; then
      checks_url="$server_url/$repository/actions/runs/$GITHUB_RUN_ID"
    fi
  fi
  local approval_status="${DEPLOY_APPROVAL_STATUS:-local-deploy-gate-passed}"
  local approval_actor="${DEPLOY_APPROVAL_ACTOR:-}"
  local approval_ref="${DEPLOY_APPROVAL_REF:-}"
  mkdir -p "$RUNTIME_DIR"
  jq -cn \
    --arg at "$at" \
    --arg deploymentId "$DEPLOYMENT_CORRELATION_ID" \
    --arg commit "$commit" \
    --arg previousCommit "$PREVIOUS_DEPLOYMENT_COMMIT" \
    --arg build "$EXPECTED_BUILD" \
    --arg service "hermes-workspace.service" \
    --arg canary "passed" \
    --arg releaseSmoke "passed" \
    --arg securityGate "passed" \
    --arg repository "$repository" \
    --arg commitUrl "$commit_url" \
    --arg checksUrl "$checks_url" \
    --arg deploymentUrl "$deployment_url" \
    --arg approvalStatus "$approval_status" \
    --arg approvalActor "$approval_actor" \
    --arg approvalRef "$approval_ref" \
    '{
      at: $at,
      deploymentId: $deploymentId,
      commit: $commit,
      previousCommit: (if $previousCommit == "" then null else $previousCommit end),
      build: $build,
      service: $service,
      canary: $canary,
      releaseSmoke: $releaseSmoke,
      securityGate: $securityGate,
      links: {
        repository: (if $repository == "" then null else $repository end),
        commit: (if $commitUrl == "" then null else $commitUrl end),
        checks: (if $checksUrl == "" then null else $checksUrl end),
        deployment: (if $deploymentUrl == "" then null else $deploymentUrl end)
      },
      approval: {
        status: $approvalStatus,
        actor: (if $approvalActor == "" then null else $approvalActor end),
        reference: (if $approvalRef == "" then null else $approvalRef end)
      }
    }' >> "$journal"
  tail -n 100 "$journal" > "$tmp"
  mv "$tmp" "$journal"
  chmod 600 "$journal"
}

rollback_failed_release() {
  local exit_code=$?
  if [ "$ROLLBACK_ACTIVE" = "1" ] || [ -z "$ROLLBACK_DIR" ] || [ ! -d "$ROLLBACK_DIR" ]; then
    exit "$exit_code"
  fi
  ROLLBACK_ACTIVE=1
  trap - ERR
  echo "error: deployment validation failed; restoring previous compiled artifact" >&2
  rm -rf dist
  mv "$ROLLBACK_DIR/dist" dist
  if [ -f "$ROLLBACK_DIR/build-commit" ]; then
    cp "$ROLLBACK_DIR/build-commit" "$BUILD_MARKER"
  else
    rm -f "$BUILD_MARKER"
  fi
  if sudo systemctl restart hermes-workspace && curl -sf -o /dev/null http://127.0.0.1:3000/; then
    local rollback_build
    rollback_build="$(artifact_build_id)"
    if RELEASE_SMOKE_EXPECTED_BUILD="$rollback_build" node scripts/release-checklist.mjs http://127.0.0.1:3000; then
      if [[ -n "${AUTH_E2E_PASSWORD:-}" && -n "${AUTH_E2E_BASE_URL:-}" ]]; then
        if AUTH_E2E_EXPECTED_BUILD="$rollback_build" node scripts/authenticated-browser-smoke.mjs; then
          echo "==> rollback recovered the previous release and passed authenticated browser smoke" >&2
        else
          echo "error: rollback release smoke passed but authenticated browser smoke failed" >&2
        fi
      else
        echo "==> rollback recovered the previous release" >&2
      fi
    else
      echo "error: rollback release smoke failed; manual intervention required" >&2
    fi
  else
    echo "error: rollback service restart or health check failed; manual intervention required" >&2
  fi
  exit "$exit_code"
}

WORKTREE_STATUS="$(git status --porcelain)"
if [ "$PREVIEW" = "0" ] && [ -n "$WORKTREE_STATUS" ]; then
  echo "error: deploy directory has uncommitted changes — refusing deployment." >&2
  git status --short >&2
  exit 1
fi

git fetch origin main --quiet

CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse origin/main)
if [ "$PREVIEW" = "1" ]; then
  changed_files=0
  changed_runtime_json='[]'
  migration_json='[]'
  changed_file_list_json='[]'
  worktree_dirty=false
  [ -n "$WORKTREE_STATUS" ] && worktree_dirty=true
  action=deploy-target
  [ "$CURRENT" = "$TARGET" ] && action=verify-live
  if [ "$CURRENT" != "$TARGET" ]; then
    changed_file_list="$(git diff --name-only "$CURRENT" "$TARGET")"
    changed_files="$(printf '%s\n' "$changed_file_list" | sed '/^$/d' | wc -l | tr -d ' ')"
    changed_file_list_json="$(printf '%s\n' "$changed_file_list" | jq -Rsc 'split("\n") | map(select(length > 0))')"
    changed_runtime_json="$(printf '%s\n' "$changed_file_list" | jq -Rsc 'split("\n") | map(select(length > 0 and test("^(src/|public/|server-entry\\.js$|index\\.html$|vite\\.config\\.|package\\.json$|pnpm-lock\\.yaml$|electron/)")))')"
    migration_json="$(printf '%s\n' "$changed_file_list" | jq -Rsc 'split("\n") | map(select(length > 0 and test("(^|/)(migrations?|schema|.*\\.sql$)"; "i")))')"
  fi
  rollback_target="$PREVIOUS_DEPLOYMENT_COMMIT"
  [ -n "$rollback_target" ] || rollback_target="$CURRENT"
  rollback_available=false
  [ -d dist ] && rollback_available=true
  preview_service="${HERMES_SERVICE_NAME:-hermes-workspace.service}"
  live_service_active=false
  [ "$(systemctl is-active "$preview_service" 2>/dev/null || true)" = "active" ] && live_service_active=true
  live_marker=""
  [ -f "$BUILD_MARKER" ] && live_marker="$(tr -d '\r\n' < "$BUILD_MARKER")"
  live_served_build="$(curl -fsSIL --max-time 3 http://127.0.0.1:3000/ 2>/dev/null | awk -F': *' 'tolower($1) == "x-workspace-build" { gsub("\r", "", $2); print $2; exit }' || true)"
  live_artifact_build=""
  [ -f dist/server/server.js ] && live_artifact_build="$(artifact_build_id)"
  live_coherent=false
  if [ "$live_service_active" = true ] && [ "$live_marker" = "$CURRENT" ] && [ -n "$live_served_build" ] && [ "$live_served_build" = "$live_artifact_build" ]; then
    live_coherent=true
  fi
  rollback_target_json="$(printf '%s' "$rollback_target" | jq -Rsc '.')"
  approval_status="${DEPLOY_APPROVAL_STATUS:-not-requested}"
  approval_actor="${DEPLOY_APPROVAL_ACTOR:-}"
  approval_ref="${DEPLOY_APPROVAL_REF:-}"
  current_image_tag="${DEPLOY_CURRENT_IMAGE_TAG:-${CURRENT_IMAGE_TAG:-}}"
  target_image_tag="${DEPLOY_IMAGE_TAG:-${TARGET_IMAGE_TAG:-}}"
  jq -cn \
    --arg current "$CURRENT" \
    --arg target "$TARGET" \
    --arg action "$action" \
    --arg rollbackTarget "$rollback_target" \
    --arg approvalStatus "$approval_status" \
    --arg approvalActor "$approval_actor" \
    --arg approvalRef "$approval_ref" \
    --arg currentImageTag "$current_image_tag" \
    --arg targetImageTag "$target_image_tag" \
    --arg deploymentId "$DEPLOYMENT_CORRELATION_ID" \
    --arg liveMarker "$live_marker" \
    --arg liveServedBuild "$live_served_build" \
    --arg liveArtifactBuild "$live_artifact_build" \
    --argjson liveServiceActive "$live_service_active" \
    --argjson liveCoherent "$live_coherent" \
    --argjson changedFileList "$changed_file_list_json" \
    --argjson changedRuntimeFiles "$changed_runtime_json" \
    --argjson migrationFiles "$migration_json" \
    --argjson worktreeDirty "$worktree_dirty" \
    --argjson changedFiles "$changed_files" \
    --argjson rollbackArtifactAvailable "$rollback_available" \
    --arg service "$preview_service" \
    '{
      preview: true,
      action: $action,
      deploymentId: $deploymentId,
      current: $current,
      target: $target,
      worktreeDirty: $worktreeDirty,
      changedFiles: $changedFiles,
      changedFileList: $changedFileList,
      changedRuntimeFiles: $changedRuntimeFiles,
      migrationFiles: $migrationFiles,
      imageTags: {
        current: (if $currentImageTag == "" then null else $currentImageTag end),
        target: (if $targetImageTag == "" then null else $targetImageTag end)
      },
      rollback: {
        target: $rollbackTarget,
        artifactAvailable: $rollbackArtifactAvailable,
        service: $service
      },
      live: {
        serviceActive: $liveServiceActive,
        deploymentMarker: (if $liveMarker == "" then null else $liveMarker end),
        servedBuild: (if $liveServedBuild == "" then null else $liveServedBuild end),
        artifactBuild: (if $liveArtifactBuild == "" then null else $liveArtifactBuild end),
        coherent: $liveCoherent
      },
      approval: {
        required: ($current != $target),
        status: $approvalStatus,
        actor: (if $approvalActor == "" then null else $approvalActor end),
        reference: (if $approvalRef == "" then null else $approvalRef end)
      },
      securityEvidenceRequired: true
    }'
  exit 0
fi
if [ "$CURRENT" = "$TARGET" ]; then
  [ -f dist/server/server.js ] || { echo "error: build artifact is missing" >&2; exit 1; }
  EXPECTED_BUILD="$(artifact_build_id)"
  if [ -f "$BUILD_MARKER" ] && grep -Fxq "$CURRENT" "$BUILD_MARKER"; then
    if [ "$QUIET_IF_UNCHANGED" = "1" ]; then
      RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" node scripts/release-smoke.mjs http://127.0.0.1:3000 >/dev/null
      exit 0
    fi
    echo "==> already up to date at $CURRENT"
    RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" node scripts/release-checklist.mjs http://127.0.0.1:3000
    exit 0
  fi
  echo "==> build marker missing or mismatched; rebuilding $CURRENT"
fi

if [ "$CURRENT" != "$TARGET" ]; then
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
fi

echo "==> verifying CodeQL security evidence for $(git rev-parse HEAD)"
pnpm run security:deployment-gate -- "$(git rev-parse HEAD)"

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> pnpm build"
mkdir -p "$RUNTIME_DIR"
ROLLBACK_DIR="$(mktemp -d "$RUNTIME_DIR/rollback.XXXXXX")"
cp -a dist "$ROLLBACK_DIR/dist"
if [ -f "$BUILD_MARKER" ]; then cp "$BUILD_MARKER" "$ROLLBACK_DIR/build-commit"; fi
trap rollback_failed_release ERR
# Vite does not guarantee removal of every previously generated hashed asset.
# Keep the rollback snapshot, then build from an empty artifact directory so
# SSR cannot reference a stale client chunk from an earlier release.
rm -rf dist
mkdir -p dist/server
pnpm build
echo "==> checking built SSR/client asset integrity"
pnpm run check:build-integrity

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
    node scripts/canary-smoke.mjs http://127.0.0.1:3000
    # The checklist includes the live release smoke and the artifact/service
    # gates. Keep it as the final success criterion so a deployment cannot
    # advance its marker after only the lightweight canary passes.
    RELEASE_SMOKE_EXPECTED_BUILD="$EXPECTED_BUILD" node scripts/release-checklist.mjs http://127.0.0.1:3000
    record_deployment
    printf '%s\n' "$(git rev-parse HEAD)" > "$BUILD_MARKER"
    rm -rf "$ROLLBACK_DIR"
    ROLLBACK_DIR=""
    trap - ERR
    echo "==> deployed $(git rev-parse --short HEAD), service healthy (pid=${NEW_PID:-unknown})"
    exit 0
  fi
  sleep 1
done

echo "error: service did not become healthy within 15s after restart" >&2
sudo systemctl status hermes-workspace --no-pager >&2
exit 1
