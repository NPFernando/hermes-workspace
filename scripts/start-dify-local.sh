#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIFY_DIR="${DIFY_DIR:-${SCRIPT_DIR}/../../dify}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dify-local}"

if [ ! -f "$DIFY_DIR/docker/docker-compose.yaml" ]; then
  echo "Dify checkout not found: $DIFY_DIR" >&2
  echo "Set DIFY_DIR to the official Dify checkout." >&2
  exit 1
fi

cd "$DIFY_DIR/docker"
docker compose \
  --project-name "$COMPOSE_PROJECT_NAME" \
  -f docker-compose.yaml \
  -f docker-compose.local.yaml \
  up -d

docker compose \
  --project-name "$COMPOSE_PROJECT_NAME" \
  -f docker-compose.yaml \
  -f docker-compose.local.yaml \
  ps
