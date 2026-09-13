-- Dedicated database: SWARM_QUEUE_PG_DATABASE=hermes_swarm_queue
-- Apply from the Hermes workspace with scripts/migrate-swarm-queue.mjs.
CREATE TABLE IF NOT EXISTS public.swarm_dispatch_queue_jobs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN (
    'pending', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'
  )),
  assignment_count integer NOT NULL CHECK (assignment_count BETWEEN 1 AND 12),
  payload jsonb NOT NULL,
  result jsonb,
  error text,
  cancel_requested_at timestamptz,
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS swarm_dispatch_queue_pending_order_idx
  ON public.swarm_dispatch_queue_jobs (queued_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS swarm_dispatch_queue_status_recent_idx
  ON public.swarm_dispatch_queue_jobs (status, queued_at DESC);
