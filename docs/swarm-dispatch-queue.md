# Durable serial dispatch queue

Serial swarm dispatches use a dedicated Postgres database. They do not use the
finance or research stores. Set `SWARM_QUEUE_PG_DATABASE` in the Hermes
environment file (for this host, `~/.hermes/.env`) to a dedicated database
name such as `hermes_swarm_queue`. The queue reuses the existing Hermes Postgres
connection credentials, but stores its records in that separate database.

Provision and migrate the database from the workspace:

```sh
pnpm swarm-queue:provision
pnpm swarm-queue:migrate
```

The server refuses to fall back to an in-memory or finance/research queue if the
database is missing or unavailable. Serial dispatch is authenticated and remains
opt-in; parallel dispatch is unchanged.

Queue jobs persist their payload, status, timestamps, result, and error. A
session-level Postgres advisory lock is held while the serial worker runs, so
other server instances cannot claim jobs concurrently. Pending jobs survive
restarts and resume when the server starts. A job that was already running when
the process died is marked `interrupted` and is not replayed automatically:
agent prompt delivery is not transactionally idempotent, so blind replay could
send the same task twice. Inspect the agent state before manually retrying it.

Pending jobs can be cancelled immediately. Cancelling the active job interrupts
its current agent command (SIGTERM for one-shot execution or Ctrl-C in the
managed tmux session). Serial batches require a terminal agent checkpoint before
advancing; if no terminal checkpoint arrives by the configured wait timeout, the
batch fails with its partial result and later assignments are not sent.

The authenticated `GET /api/swarm-dispatch` endpoint returns the active job,
pending jobs, and recent terminal statuses without exposing prompts. Send
`DELETE /api/swarm-dispatch?id=<uuid>` to cancel a pending or active job.

The Postgres integration suite is deliberately opt-in and must target a
dedicated `*_test` database:

```sh
SWARM_QUEUE_PG_DATABASE=hermes_swarm_queue_test pnpm swarm-queue:migrate
RUN_SWARM_QUEUE_PG_INTEGRATION=1 \
  SWARM_QUEUE_PG_DATABASE=hermes_swarm_queue_test \
  pnpm exec vitest run src/server/swarm-dispatch-queue.test.ts
```
