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

Queue jobs persist their payload, status, priority, timestamps, result, error, retry link,
and dead-letter time. A session-level Postgres advisory lock is held while the
serial worker runs, so other server instances cannot claim jobs concurrently.
Each running job also has a 15-second lease renewed every second. The worker
uses a per-claim fencing token when renewing and finishing; a worker that loses
its lease aborts its signal and cannot overwrite the newer queue state. A new
worker waits for a still-valid lease to expire before recovering abandoned work.
Pending jobs survive restarts and resume when the server starts.

Serial POST requests may set `priority` to an integer from `0` (normal) through
`9` (highest). Higher-priority pending jobs run first; jobs with the same
priority retain FIFO ordering. Retries preserve the source job's priority.
Invalid priorities are rejected with HTTP 400.

Failed and interrupted jobs are retained as dead letters. They are never
automatically replayed because dispatch may have reached some agents before a
failure. The queue UI offers a manual retry only after the operator confirms
they inspected agent state and accepts possible duplicate prompts. A retry is
a new linked job; repeated requests for the same source job return the same
retry job instead of creating duplicates. Serial POST requests can also send an
`Idempotency-Key` header (1-128 safe characters): an identical retry of that
HTTP submission returns the original queued job, while reusing the key for a
different payload returns HTTP 409.

When a worker successfully records a failed or interrupted terminal state, it
publishes one chat notification to the job's `notifySessionKey` (or `main`).
The notification includes the queue ID and failure state, but never includes
the queued prompt payload. Lost leases cannot emit a duplicate notification;
delivery failures are non-fatal and the dead-letter record remains durable.

Pending jobs can be cancelled immediately. Cancelling the active job interrupts
its current agent command (SIGTERM for one-shot execution or Ctrl-C in the
managed tmux session). Serial batches require a terminal agent checkpoint before
advancing; if no terminal checkpoint arrives by the configured wait timeout, the
batch fails with its partial result and later assignments are not sent.

The authenticated `GET /api/swarm-dispatch` endpoint returns the active job,
pending jobs, and recent terminal statuses without exposing prompts. Send
`DELETE /api/swarm-dispatch?id=<uuid>` to cancel a pending or active job.
The authenticated `PATCH /api/swarm-dispatch?id=<uuid>` endpoint only requeues
failed/interrupted dead letters when the body explicitly sets
`{"acknowledgePossibleDuplicate":true}`.

The Postgres integration suite is deliberately opt-in and must target a
dedicated loopback `*_test` database with explicit test credentials. The
recommended runner creates and removes its own disposable PostgreSQL instance;
it never reads `~/.hermes/.env`:

```sh
pnpm test:queue:isolated
```

The integration suite covers concurrent duplicate submissions, independent
worker processes, priority/FIFO ordering, lease renewal and expiry, restart recovery,
cancellation, dead-letter handling, explicit retry, and retry idempotency. It
never inserts or dispatches synthetic jobs into a production database.
