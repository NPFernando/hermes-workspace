import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Pool } from 'pg'
import type { PoolClient, PoolConfig } from 'pg'

const TABLE = 'public.swarm_dispatch_queue_jobs'
const LEADER_LOCK_A = 918_231
const LEADER_LOCK_B = 112
const ENQUEUE_LOCK_A = 918_232
const ENQUEUE_LOCK_B = 112
const MAX_PENDING = 12
const POLL_MS = 1_000

export type SwarmDispatchQueueStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type SwarmDispatchQueueJob<TPayload = Record<string, unknown>> = {
  id: string
  status: SwarmDispatchQueueStatus
  assignmentCount: number
  payload: TPayload
  result: unknown
  error: string | null
  cancelRequestedAt: number | null
  queuedAt: number
  startedAt: number | null
  finishedAt: number | null
}

export type SwarmDispatchQueueItem = {
  id: string
  position: number
  queuedAt: number
  startedAt: number | null
  assignmentCount: number
  status: SwarmDispatchQueueStatus
  cancelRequestedAt: number | null
}

export type SwarmDispatchQueueSnapshot = {
  mode: 'postgres'
  active: SwarmDispatchQueueItem | null
  waiting: Array<SwarmDispatchQueueItem>
  recent: Array<SwarmDispatchQueueItem>
}

export class SwarmDispatchQueueFullError extends Error {
  constructor() {
    super('Serial dispatch queue is full; retry after a queued batch finishes.')
    this.name = 'SwarmDispatchQueueFullError'
  }
}

export class SwarmDispatchQueueUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SwarmDispatchQueueUnavailableError'
  }
}

type QueueRow = {
  id: string
  status: SwarmDispatchQueueStatus
  assignment_count: number
  payload: Record<string, unknown>
  result: unknown
  error: string | null
  cancel_requested_at: Date | string | null
  queued_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
}

export type QueueWorkerContext = { signal: AbortSignal; jobId: string }
export type QueueProcessor = (
  payload: Record<string, unknown>,
  context: QueueWorkerContext,
) => Promise<unknown>

let pool: Pool | null = null
let schemaChecked = false
let workerStarted = false

type QueueEnvKey =
  | 'HERMES_PG_PASSWORD'
  | 'HERMES_PG_HOST'
  | 'HERMES_PG_PORT'
  | 'HERMES_PG_USER'
  | 'SWARM_QUEUE_PG_DATABASE'

function parseHermesEnv(): Partial<Record<QueueEnvKey, string>> {
  const home =
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  const values: Partial<Record<QueueEnvKey, string>> = {}
  for (const envPath of [path.join(home, '.env'), path.join(home, '.hermes.backup', '.env')]) {
    let contents = ''
    try {
      contents = fs.readFileSync(envPath, 'utf8')
    } catch {
      continue
    }
    for (const line of contents.split('\n')) {
      const match = line.match(
        /^(HERMES_PG_(?:PASSWORD|HOST|PORT|USER)|SWARM_QUEUE_PG_DATABASE)=(.*)$/,
      )
      if (match) {
        values[match[1] as QueueEnvKey] = match[2].trim().replace(/^"|"$/g, '')
      }
    }
  }
  return values
}

function getPool(): Pool {
  if (pool) return pool
  const file = parseHermesEnv()
  const database =
    process.env.SWARM_QUEUE_PG_DATABASE ?? file.SWARM_QUEUE_PG_DATABASE
  const forbidden = new Set([
    'finance',
    'personal_finance',
    'research',
    'agents',
    'harp',
  ])
  if (!database || forbidden.has(database.toLowerCase())) {
    throw new SwarmDispatchQueueUnavailableError(
      'Set SWARM_QUEUE_PG_DATABASE to a dedicated queue database; finance and research databases are not allowed.',
    )
  }

  const password = process.env.HERMES_PG_PASSWORD ?? file.HERMES_PG_PASSWORD
  if (!password) {
    throw new SwarmDispatchQueueUnavailableError(
      'PostgreSQL credentials for the dedicated serial queue are unavailable.',
    )
  }
  const config: PoolConfig = {
    host: process.env.HERMES_PG_HOST ?? file.HERMES_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.HERMES_PG_PORT ?? file.HERMES_PG_PORT ?? '5432'),
    user: process.env.HERMES_PG_USER ?? file.HERMES_PG_USER ?? 'hermes_app',
    password,
    database,
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'hermes-swarm-serial-queue',
  }
  pool = new Pool(config)
  pool.on('error', () => {
    // Do not log database errors verbatim: connection details may be sensitive.
  })
  return pool
}

function toMillis(value: Date | string | null): number | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  const timestamp = date.getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function mapJob<TPayload = Record<string, unknown>>(
  row: QueueRow,
): SwarmDispatchQueueJob<TPayload> {
  return {
    id: row.id,
    status: row.status,
    assignmentCount: Number(row.assignment_count),
    payload: row.payload as TPayload,
    result: row.result,
    error: row.error,
    cancelRequestedAt: toMillis(row.cancel_requested_at),
    queuedAt: toMillis(row.queued_at) ?? Date.now(),
    startedAt: toMillis(row.started_at),
    finishedAt: toMillis(row.finished_at),
  }
}

async function ensureSchema(): Promise<Pool> {
  const pg = getPool()
  if (schemaChecked) return pg
  try {
    const result = await pg.query<{ table_name: string | null }>(
      `SELECT to_regclass($1)::text AS table_name`,
      [TABLE],
    )
    if (!result.rows[0]?.table_name) {
      throw new SwarmDispatchQueueUnavailableError(
        'Dedicated queue database is reachable, but its schema is missing. Run pnpm swarm-queue:migrate.',
      )
    }
    schemaChecked = true
    return pg
  } catch (error) {
    if (error instanceof SwarmDispatchQueueUnavailableError) throw error
    throw new SwarmDispatchQueueUnavailableError(
      'Could not connect to the dedicated Postgres queue database.',
    )
  }
}

export async function enqueueSwarmDispatch(
  payload: object,
  assignmentCount: number,
): Promise<{ id: string; position: number; queuedAt: number }> {
  const pg = await ensureSchema()
  const client = await pg.connect()
  const id = randomUUID()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      ENQUEUE_LOCK_A,
      ENQUEUE_LOCK_B,
    ])
    const pending = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${TABLE} WHERE status = 'pending'`,
    )
    if (Number(pending.rows[0]?.count ?? 0) >= MAX_PENDING) {
      await client.query('ROLLBACK')
      throw new SwarmDispatchQueueFullError()
    }
    const inserted = await client.query<QueueRow>(
      `INSERT INTO ${TABLE} (id, status, assignment_count, payload)
       VALUES ($1, 'pending', $2, $3::jsonb)
       RETURNING id, status, assignment_count, payload, result, error,
         cancel_requested_at, queued_at, started_at, finished_at`,
      [id, Math.max(1, Math.min(12, Math.floor(assignmentCount))), JSON.stringify(payload)],
    )
    const position = await client.query<{ position: string }>(
      `SELECT count(*)::text AS position FROM ${TABLE}
       WHERE status = 'pending' AND (queued_at, id) <= ($1::timestamptz, $2::uuid)`,
      [inserted.rows[0].queued_at, id],
    )
    await client.query('COMMIT')
    return {
      id,
      position: Number(position.rows[0]?.position ?? 1),
      queuedAt: toMillis(inserted.rows[0].queued_at) ?? Date.now(),
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore cleanup failures; preserve the original error.
    }
    if (
      error instanceof SwarmDispatchQueueFullError ||
      error instanceof SwarmDispatchQueueUnavailableError
    ) throw error
    throw new SwarmDispatchQueueUnavailableError(
      'Could not persist the serial dispatch in the dedicated queue database.',
    )
  } finally {
    client.release()
  }
}

export async function getSwarmDispatchQueueJob(
  id: string,
): Promise<SwarmDispatchQueueJob | null> {
  const pg = await ensureSchema()
  const result = await pg.query<QueueRow>(
    `SELECT id, status, assignment_count, payload, result, error,
       cancel_requested_at, queued_at, started_at, finished_at
     FROM ${TABLE} WHERE id = $1::uuid`,
    [id],
  )
  return result.rows[0] ? mapJob(result.rows[0]) : null
}

export async function waitForSwarmDispatchQueueJob(
  id: string,
  pollMs = POLL_MS,
): Promise<SwarmDispatchQueueJob | null> {
  for (;;) {
    const job = await getSwarmDispatchQueueJob(id)
    if (!job || job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') return job
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

export async function cancelSwarmDispatchQueueJob(
  id: string,
): Promise<{ found: boolean; status: SwarmDispatchQueueStatus | null }> {
  const pg = await ensureSchema()
  const result = await pg.query<{ status: SwarmDispatchQueueStatus }>(
    `UPDATE ${TABLE}
       SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
           cancel_requested_at = COALESCE(cancel_requested_at, clock_timestamp()),
           finished_at = CASE WHEN status = 'pending' THEN clock_timestamp() ELSE finished_at END,
           updated_at = clock_timestamp()
     WHERE id = $1::uuid AND status IN ('pending', 'running')
     RETURNING status`,
    [id],
  )
  if (result.rows[0]) return { found: true, status: result.rows[0].status }
  const existing = await getSwarmDispatchQueueJob(id)
  return { found: Boolean(existing), status: existing?.status ?? null }
}

export async function getSwarmDispatchQueueSnapshot(): Promise<SwarmDispatchQueueSnapshot> {
  const pg = await ensureSchema()
  const [active, waiting, recent] = await Promise.all([
    pg.query<QueueRow>(
      `SELECT id, status, assignment_count, payload, result, error,
         cancel_requested_at, queued_at, started_at, finished_at
       FROM ${TABLE} WHERE status = 'running' ORDER BY started_at LIMIT 1`,
    ),
    pg.query<QueueRow>(
      `SELECT id, status, assignment_count, payload, result, error,
         cancel_requested_at, queued_at, started_at, finished_at
       FROM ${TABLE} WHERE status = 'pending' ORDER BY queued_at, id LIMIT 50`,
    ),
    pg.query<QueueRow>(
      `SELECT id, status, assignment_count, payload, result, error,
         cancel_requested_at, queued_at, started_at, finished_at
       FROM ${TABLE} WHERE status IN ('succeeded', 'failed', 'cancelled', 'interrupted')
       ORDER BY finished_at DESC NULLS LAST LIMIT 20`,
    ),
  ])
  const toItem = (row: QueueRow, position: number): SwarmDispatchQueueItem => {
    const job = mapJob(row)
    return {
      id: job.id,
      position,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      assignmentCount: job.assignmentCount,
      status: job.status,
      cancelRequestedAt: job.cancelRequestedAt,
    }
  }
  return {
    mode: 'postgres',
    active: active.rows[0] ? toItem(active.rows[0], 0) : null,
    waiting: waiting.rows.map((row, index) => toItem(row, index + 1)),
    recent: recent.rows.map((row) => toItem(row, 0)),
  }
}

async function claimNextJob(client: PoolClient): Promise<SwarmDispatchQueueJob | null> {
  await client.query('BEGIN')
  try {
    const claimed = await client.query<QueueRow>(
      `WITH next_job AS (
         SELECT id FROM ${TABLE}
         WHERE status = 'pending'
         ORDER BY queued_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE ${TABLE} AS jobs
       SET status = 'running', started_at = clock_timestamp(), updated_at = clock_timestamp()
       FROM next_job
       WHERE jobs.id = next_job.id
       RETURNING jobs.id, jobs.status, jobs.assignment_count, jobs.payload, jobs.result,
         jobs.error, jobs.cancel_requested_at, jobs.queued_at, jobs.started_at, jobs.finished_at`,
    )
    await client.query('COMMIT')
    return claimed.rows[0] ? mapJob(claimed.rows[0]) : null
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function finishJob(
  id: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  result: unknown,
  error: string | null,
): Promise<void> {
  const pg = await ensureSchema()
  await pg.query(
    `UPDATE ${TABLE}
     SET status = CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancelled' ELSE $2 END,
         result = $3::jsonb, error = $4,
         finished_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = $1::uuid AND status = 'running'`,
    [id, status, result === undefined ? null : JSON.stringify(result), error],
  )
}

async function recoverInterruptedJobs(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE ${TABLE}
     SET status = 'interrupted',
         error = COALESCE(error, 'Queue worker stopped before completion; verify agent state before retrying.'),
         finished_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE status = 'running'`,
  )
}

async function processQueue(processor: QueueProcessor): Promise<void> {
  const pg = await ensureSchema()
  const client = await pg.connect()
  let ownsLock = false
  try {
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      [LEADER_LOCK_A, LEADER_LOCK_B],
    )
    ownsLock = lock.rows[0]?.acquired === true
    if (!ownsLock) return

    await recoverInterruptedJobs(client)
    for (;;) {
      const job = await claimNextJob(client)
      if (!job) break
      const controller = new AbortController()
      const cancelPoll = setInterval(() => {
        void getSwarmDispatchQueueJob(job.id)
          .then((current) => {
            if (current?.cancelRequestedAt) controller.abort()
          })
          .catch(() => undefined)
      }, POLL_MS)
      cancelPoll.unref()
      let result: unknown = null
      let errorMessage: string | null = null
      let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
      try {
        result = await processor(job.payload, { signal: controller.signal, jobId: job.id })
        const cancelled = await getSwarmDispatchQueueJob(job.id)
        if (controller.signal.aborted || cancelled?.cancelRequestedAt) {
          status = 'cancelled'
        } else if (
          result && typeof result === 'object' &&
          Array.isArray((result as { results?: unknown }).results) &&
          ((result as { results: Array<{ ok?: unknown }> }).results).some((item) => item.ok !== true)
        ) {
          status = 'failed'
          errorMessage = 'One or more agent assignments failed; inspect the saved result.'
        }
      } catch {
        status = controller.signal.aborted ? 'cancelled' : 'failed'
        errorMessage = controller.signal.aborted
          ? 'Cancellation requested; active dispatch was interrupted.'
          : 'Dispatch failed; inspect the server logs and agent state.'
      } finally {
        clearInterval(cancelPoll)
      }
      await finishJob(job.id, status, result, errorMessage)
    }
  } finally {
    if (ownsLock) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [
          LEADER_LOCK_A,
          LEADER_LOCK_B,
        ])
      } catch {
        // Closing the connection also releases its session advisory lock.
      }
    }
    client.release()
  }
}

/** One polling/claim cycle, exposed for isolated PostgreSQL integration tests. */
export async function runSwarmDispatchQueueCycle(
  processor: QueueProcessor,
): Promise<void> {
  await processQueue(processor)
}

export function startSwarmDispatchQueueWorker(processor: QueueProcessor): void {
  if (workerStarted) return
  workerStarted = true
  const poll = async () => {
    try {
      await processQueue(processor)
    } catch {
      // A missing database/schema is reported by the HTTP handler; the worker
      // keeps retrying so queued jobs resume after a transient DB outage.
    } finally {
      const timer = setTimeout(() => void poll(), POLL_MS)
      timer.unref()
    }
  }
  void poll()
}

export async function closeSwarmDispatchQueuePool(): Promise<void> {
  if (!pool) return
  const current = pool
  pool = null
  schemaChecked = false
  workerStarted = false
  await current.end()
}
