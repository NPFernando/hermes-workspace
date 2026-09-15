-- Dedicated database: SWARM_QUEUE_PG_DATABASE=hermes_swarm_queue
-- Apply explicitly from the Hermes workspace with:
--   pnpm swarm-queue:migrate
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

-- Explicit migration additions for installations that already have the table.
ALTER TABLE public.swarm_dispatch_queue_jobs
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_of_job_id uuid REFERENCES public.swarm_dispatch_queue_jobs(id),
  ADD COLUMN IF NOT EXISTS submission_key text;

-- Preserve old in-flight jobs without permitting a second worker to claim them
-- until the previous process's advisory lock has been released and its lease
-- window has elapsed.
UPDATE public.swarm_dispatch_queue_jobs
SET lease_token = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + interval '30 seconds'
WHERE status = 'running' AND lease_token IS NULL;

UPDATE public.swarm_dispatch_queue_jobs
SET dead_letter_at = COALESCE(finished_at, updated_at, clock_timestamp())
WHERE status IN ('failed', 'interrupted') AND dead_letter_at IS NULL;

CREATE INDEX IF NOT EXISTS swarm_dispatch_queue_pending_order_idx
  ON public.swarm_dispatch_queue_jobs (queued_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS swarm_dispatch_queue_status_recent_idx
  ON public.swarm_dispatch_queue_jobs (status, queued_at DESC);

CREATE INDEX IF NOT EXISTS swarm_dispatch_queue_running_lease_idx
  ON public.swarm_dispatch_queue_jobs (lease_expires_at)
  WHERE status = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS swarm_dispatch_queue_retry_once_idx
  ON public.swarm_dispatch_queue_jobs (retry_of_job_id)
  WHERE retry_of_job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS swarm_dispatch_queue_submission_once_idx
  ON public.swarm_dispatch_queue_jobs (submission_key)
  WHERE submission_key IS NOT NULL;
