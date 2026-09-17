#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER="hermes-queue-test-${USER:-runner}-$$"
TEMP_HERMES_HOME="$(mktemp -d)"
ADMIN_PASSWORD="$(openssl rand -hex 24)"
APP_PASSWORD="$(openssl rand -hex 24)"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf -- "$TEMP_HERMES_HOME"
}
trap cleanup EXIT INT TERM

docker run --rm -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null

DB_PORT=""
READY_COUNT=0
for _ in $(seq 1 60); do
  DB_PORT="$(docker port "$CONTAINER" 5432/tcp 2>/dev/null | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | head -n 1)"
  # The image's temporary initialization server can pass pg_isready before
  # being stopped. Require stable successful SQL queries against the final DB.
  if [[ -n "$DB_PORT" ]] && docker exec "$CONTAINER" psql -U postgres -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then
    READY_COUNT=$((READY_COUNT + 1))
    if [[ "$READY_COUNT" -ge 3 ]]; then
      break
    fi
  else
    READY_COUNT=0
  fi
  sleep 1
done
if [[ -z "$DB_PORT" || "$READY_COUNT" -lt 3 ]]; then
  echo "Could not start isolated Hermes queue PostgreSQL on loopback" >&2
  exit 1
fi

docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -v app_password="$APP_PASSWORD" <<'SQL'
CREATE ROLE hermes_queue_test_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE hermes_swarm_queue_test OWNER hermes_queue_test_app;
SQL

docker exec -i "$CONTAINER" psql -U postgres -d hermes_swarm_queue_test -v ON_ERROR_STOP=1 < scripts/swarm-dispatch-queue.sql
# The deployable SQL is an explicit migration. Prove that reapplying it is
# safe so operators can recover from an interrupted deployment without a
# hidden startup migration or destructive reset.
docker exec -i "$CONTAINER" psql -U postgres -d hermes_swarm_queue_test -v ON_ERROR_STOP=1 < scripts/swarm-dispatch-queue.sql
docker exec -i "$CONTAINER" psql -U postgres -d hermes_swarm_queue_test -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO hermes_queue_test_app;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.swarm_dispatch_queue_jobs TO hermes_queue_test_app;
SQL

HERMES_HOME="$TEMP_HERMES_HOME" \
HERMES_PASSWORD="$APP_PASSWORD" \
HERMES_PG_HOST=127.0.0.1 \
HERMES_PG_PORT="$DB_PORT" \
HERMES_PG_USER=hermes_queue_test_app \
HERMES_PG_PASSWORD="$APP_PASSWORD" \
SWARM_QUEUE_PG_DATABASE=hermes_swarm_queue_test \
RUN_SWARM_QUEUE_PG_INTEGRATION=1 \
  pnpm exec vitest run --no-file-parallelism \
    src/server/swarm-dispatch-queue.test.ts \
    src/routes/api/-swarm-dispatch-isolated.integration.test.ts
