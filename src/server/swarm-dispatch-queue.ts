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
const JOB_LEASE_MS = 15_000
const LEASE_HEARTBEAT_MS = 1_000

export type SwarmDispatchQueueStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export type SwarmDispatchQueueJob<TPayload = Record<string, unknown>> = {
  id: string
  status: SwarmDispatchQueueStatus
  assignmentCount: number
  priority: number
  payload: TPayload
  result: unknown
  error: string | null
  cancelRequestedAt: number | null
  queuedAt: number
  startedAt: number | null
  finishedAt: number | null
  leaseExpiresAt: number | null
  deadLetterAt: number | null
  retryOfJobId: string | null
}

export type SwarmDispatchQueueItem = {
  id: string
  position: number
  queuedAt: number
  startedAt: number | null
  assignmentCount: number
  priority: number
  status: SwarmDispatchQueueStatus
  cancelRequestedAt: number | null
  leaseExpiresAt: number | null
  deadLetterAt: number | null
  retryOfJobId: string | null
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
  priority: number
  payload: Record<string, unknown>
  result: unknown
  error: string | null
  lease_token: string | null
  cancel_requested_at: Date | string | null
  queued_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
  lease_expires_at: Date | string | null
  dead_letter_at: Date | string | null
  retry_of_job_id: string | null
  submission_key: string | null
}

export class SwarmDispatchQueueRetryError extends Error {
  constructor(
    readonly kind: 'acknowledgement-required' | 'not-found' | 'not-retryable',
    message: string,
  ) {
    super(message)
    this.name = 'SwarmDispatchQueueRetryError'
  }
}

export class SwarmDispatchQueueIdempotencyError extends Error {
  constructor(
    readonly kind: 'invalid-key' | 'payload-conflict',
    message: string,
  ) {
    super(message)
    this.name = 'SwarmDispatchQueueIdempotencyError'
  }
}

export class SwarmDispatchQueuePriorityError extends Error {
  constructor() {
    super('Queue priority must be an integer from 0 (normal) to 9 (highest).')
    this.name = 'SwarmDispatchQueuePriorityError'
  }
}

export function normalizeSwarmDispatchPriority(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 9) {
    throw new SwarmDispatchQueuePriorityError()
  }
  return value
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
  for (const envPath of [
    path.join(home, '.env'),
    path.join(home, '.hermes.backup', '.env'),
  ]) {
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
    priority: Number(row.priority),
    payload: row.payload as TPayload,
    result: row.result,
    error: row.error,
    cancelRequestedAt: toMillis(row.cancel_requested_at),
    queuedAt: toMillis(row.queued_at) ?? Date.now(),
    startedAt: toMillis(row.started_at),
    finishedAt: toMillis(row.finished_at),
    leaseExpiresAt: toMillis(row.lease_expires_at),
    deadLetterAt: toMillis(row.dead_letter_at),
    retryOfJobId: row.retry_of_job_id,
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
  submissionKey?: string,
  priority: unknown = 0,
): Promise<{
  id: string
  position: number
  queuedAt: number
  alreadyQueued: boolean
}> {
  if (
    submissionKey !== undefined &&
    (submissionKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(submissionKey))
  ) {
    throw new SwarmDispatchQueueIdempotencyError(
      'invalid-key',
      'Idempotency-Key must contain 1 to 128 letters, digits, dots, underscores, colons, or hyphens.',
    )
  }
  const normalizedPriority = normalizeSwarmDispatchPriority(priority)
  const pg = await ensureSchema()
  const client = await pg.connect()
  const id = randomUUID()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      ENQUEUE_LOCK_A,
      ENQUEUE_LOCK_B,
    ])
    if (submissionKey !== undefined) {
      const existing = await client.query<{
        id: string
        status: SwarmDispatchQueueStatus
        assignment_count: number
        priority: number
        payload_matches: boolean
        queued_at: Date | string
      }>(
        `SELECT id, status, assignment_count, priority,
                payload = $2::jsonb AS payload_matches, queued_at
         FROM ${TABLE} WHERE submission_key = $1 FOR UPDATE`,
        [submissionKey, JSON.stringify(payload)],
      )
      if (existing.rows[0]) {
        const job = existing.rows[0]
        if (
          job.assignment_count !==
            Math.max(1, Math.min(12, Math.floor(assignmentCount))) ||
            job.priority !== normalizedPriority ||
            !job.payload_matches
        ) {
          throw new SwarmDispatchQueueIdempotencyError(
            'payload-conflict',
            'This Idempotency-Key was already used for a different dispatch payload.',
          )
        }
        const position =
          job.status === 'pending'
            ? await client.query<{ position: string }>(
                `WITH target AS (
                   SELECT priority, queued_at, id FROM ${TABLE} WHERE id = $1::uuid
                 )
                 SELECT count(*)::text AS position FROM ${TABLE} AS jobs, target
                 WHERE jobs.status = 'pending'
                   AND (jobs.priority, jobs.queued_at, jobs.id) >= (target.priority, target.queued_at, target.id)`,
                [job.id],
              )
            : null
        await client.query('COMMIT')
        return {
          id: job.id,
          position: Number(position?.rows[0]?.position ?? 0),
          queuedAt: toMillis(job.queued_at) ?? Date.now(),
          alreadyQueued: true,
        }
      }
    }
    const pending = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${TABLE} WHERE status = 'pending'`,
    )
    if (Number(pending.rows[0]?.count ?? 0) >= MAX_PENDING) {
      await client.query('ROLLBACK')
      throw new SwarmDispatchQueueFullError()
    }
    const inserted = await client.query<QueueRow>(
      `INSERT INTO ${TABLE} (id, status, assignment_count, priority, payload, submission_key)
       VALUES ($1, 'pending', $2, $3, $4::jsonb, $5)
       RETURNING id, status, assignment_count, payload, result, error,
        priority, lease_token, cancel_requested_at, queued_at, started_at, finished_at,
         lease_expires_at, dead_letter_at, retry_of_job_id`,
      [
        id,
        Math.max(1, Math.min(12, Math.floor(assignmentCount))),
        normalizedPriority,
        JSON.stringify(payload),
        submissionKey ?? null,
      ],
    )
    const position = await client.query<{ position: string }>(
      `WITH target AS (
         SELECT priority, queued_at, id FROM ${TABLE} WHERE id = $1::uuid
       )
       SELECT count(*)::text AS position FROM ${TABLE} AS jobs, target
       WHERE jobs.status = 'pending'
         AND (jobs.priority, jobs.queued_at, jobs.id) >= (target.priority, target.queued_at, target.id)`,
      [id],
    )
    await client.query('COMMIT')
    return {
      id,
      position: Number(position.rows[0]?.position ?? 1),
      queuedAt: toMillis(inserted.rows[0].queued_at) ?? Date.now(),
      alreadyQueued: false,
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore cleanup failures; preserve the original error.
    }
    if (
      error instanceof SwarmDispatchQueueFullError ||
      error instanceof SwarmDispatchQueueIdempotencyError ||
      error instanceof SwarmDispatchQueueUnavailableError
    )
      throw error
    throw new SwarmDispatchQueueUnavailableError(
      'Could not persist the serial dispatch in the dedicated queue database.',
    )
  } finally {
    client.release()
  }
}

export async function retrySwarmDispatchQueueJob(
  id: string,
  acknowledgePossibleDuplicate: boolean,
): Promise<{
  id: string
  position: number
  queuedAt: number
  retryOfJobId: string
  alreadyQueued: boolean
}> {
  if (!acknowledgePossibleDuplicate) {
    throw new SwarmDispatchQueueRetryError(
      'acknowledgement-required',
      'Explicit acknowledgement is required because an earlier attempt may have partially reached agents.',
    )
  }

  const pg = await ensureSchema()
  const client = await pg.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      ENQUEUE_LOCK_A,
      ENQUEUE_LOCK_B,
    ])
    const sourceResult = await client.query<{
      id: string
      status: SwarmDispatchQueueStatus
      assignment_count: number
      priority: number
      payload: Record<string, unknown>
      dead_letter_at: Date | string | null
    }>(
      `SELECT id, status, assignment_count, priority, payload, dead_letter_at
       FROM ${TABLE} WHERE id = $1::uuid FOR UPDATE`,
      [id],
    )
    const source = sourceResult.rows[0]
    if (sourceResult.rowCount === 0) {
      throw new SwarmDispatchQueueRetryError(
        'not-found',
        'Queue job not found.',
      )
    }
    if (
      !['failed', 'interrupted'].includes(source.status) ||
      !source.dead_letter_at
    ) {
      throw new SwarmDispatchQueueRetryError(
        'not-retryable',
        'Only failed or interrupted dead-letter jobs can be retried.',
      )
    }

    const previousRetry = await client.query<{
      id: string
      status: SwarmDispatchQueueStatus
      queued_at: Date | string
    }>(
      `SELECT id, status, queued_at FROM ${TABLE}
       WHERE retry_of_job_id = $1::uuid`,
      [id],
    )
    if (previousRetry.rows[0]) {
      const existing = previousRetry.rows[0]
      const position =
        existing.status === 'pending'
          ? await client.query<{ position: string }>(
              `WITH target AS (
                 SELECT priority, queued_at, id FROM ${TABLE} WHERE id = $1::uuid
               )
               SELECT count(*)::text AS position FROM ${TABLE} AS jobs, target
               WHERE jobs.status = 'pending'
                 AND (jobs.priority, jobs.queued_at, jobs.id) >= (target.priority, target.queued_at, target.id)`,
              [existing.id],
            )
          : null
      await client.query('COMMIT')
      return {
        id: existing.id,
        position: Number(position?.rows[0]?.position ?? 0),
        queuedAt: toMillis(existing.queued_at) ?? Date.now(),
        retryOfJobId: id,
        alreadyQueued: true,
      }
    }

    const pending = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${TABLE} WHERE status = 'pending'`,
    )
    if (Number(pending.rows[0]?.count ?? 0) >= MAX_PENDING) {
      throw new SwarmDispatchQueueFullError()
    }
    const retryId = randomUUID()
    const inserted = await client.query<QueueRow>(
      `INSERT INTO ${TABLE} (id, status, assignment_count, priority, payload, retry_of_job_id)
       VALUES ($1::uuid, 'pending', $2, $3, $4::jsonb, $5::uuid)
       RETURNING id, status, assignment_count, payload, result, error,
        priority, lease_token, cancel_requested_at, queued_at, started_at, finished_at,
         lease_expires_at, dead_letter_at, retry_of_job_id`,
      [
        retryId,
        source.assignment_count,
        source.priority,
        JSON.stringify(source.payload),
        source.id,
      ],
    )
    const position = await client.query<{ position: string }>(
      `WITH target AS (
         SELECT priority, queued_at, id FROM ${TABLE} WHERE id = $1::uuid
       )
       SELECT count(*)::text AS position FROM ${TABLE} AS jobs, target
       WHERE jobs.status = 'pending'
       AND (jobs.priority, jobs.queued_at, jobs.id) >= (target.priority, target.queued_at, target.id)`,
      [retryId],
    )
    await client.query('COMMIT')
    return {
      id: retryId,
      position: Number(position.rows[0]?.position ?? 1),
      queuedAt: toMillis(inserted.rows[0].queued_at) ?? Date.now(),
      retryOfJobId: id,
      alreadyQueued: false,
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve the original failure if transaction cleanup also fails.
    }
    if (
      error instanceof SwarmDispatchQueueRetryError ||
      error instanceof SwarmDispatchQueueFullError ||
      error instanceof SwarmDispatchQueueUnavailableError
    ) {
      throw error
    }
    throw new SwarmDispatchQueueUnavailableError(
      'Could not enqueue the reviewed retry in the dedicated queue database.',
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
       priority, lease_token, cancel_requested_at, queued_at, started_at, finished_at,
       lease_expires_at, dead_letter_at, retry_of_job_id
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
    if (
      !job ||
      job.status === 'succeeded' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'interrupted'
    )
      return job
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
         priority, lease_token, cancel_requested_at, queued_at, started_at, finished_at,
         lease_expires_at, dead_letter_at, retry_of_job_id
       FROM ${TABLE} WHERE status = 'running' ORDER BY started_at LIMIT 1`,
    ),
    pg.query<QueueRow>(
      `SELECT id, status, assignment_count, payload, result, error,
         lease_token, cancel_requested_at, queued_at, started_at, finished_at,
         lease_expires_at, dead_letter_at, retry_of_job_id
       FROM ${TABLE} WHERE status = 'pending' ORDER BY priority DESC, queued_at, id LIMIT 50`,
    ),
    pg.query<QueueRow>(
      `SELECT id, status, assignment_count, payload, result, error,
         lease_token, cancel_requested_at, queued_at, started_at, finished_at,
         lease_expires_at, dead_letter_at, retry_of_job_id
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
      priority: job.priority,
      status: job.status,
      cancelRequestedAt: job.cancelRequestedAt,
      leaseExpiresAt: job.leaseExpiresAt,
      deadLetterAt: job.deadLetterAt,
      retryOfJobId: job.retryOfJobId,
    }
  }
  return {
    mode: 'postgres',
    active: active.rows[0] ? toItem(active.rows[0], 0) : null,
    waiting: waiting.rows.map((row, index) => toItem(row, index + 1)),
    recent: recent.rows.map((row) => toItem(row, 0)),
  }
}

type ClaimedQueueJob = { job: SwarmDispatchQueueJob; leaseToken: string }

async function claimNextJob(
  client: PoolClient,
): Promise<ClaimedQueueJob | null> {
  await client.query('BEGIN')
  try {
    const leaseToken = randomUUID()
    const claimed = await client.query<QueueRow>(
      `WITH next_job AS (
         SELECT id FROM ${TABLE}
         WHERE status = 'pending'
         ORDER BY priority DESC, queued_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE ${TABLE} AS jobs
       SET status = 'running', started_at = clock_timestamp(), updated_at = clock_timestamp(),
           lease_token = $1::uuid,
           lease_expires_at = clock_timestamp() + ($2::double precision * interval '1 millisecond')
       FROM next_job
       WHERE jobs.id = next_job.id
       RETURNING jobs.id, jobs.status, jobs.assignment_count, jobs.payload, jobs.result,
         jobs.error, jobs.priority, jobs.lease_token, jobs.cancel_requested_at, jobs.queued_at,
         jobs.started_at, jobs.finished_at, jobs.lease_expires_at,
         jobs.dead_letter_at, jobs.retry_of_job_id`,
      [leaseToken, JOB_LEASE_MS],
    )
    await client.query('COMMIT')
    return claimed.rows[0] ? { job: mapJob(claimed.rows[0]), leaseToken } : null
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function finishJob(
  id: string,
  leaseToken: string,
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted',
  result: unknown,
  error: string | null,
): Promise<void> {
  const pg = await ensureSchema()
  await pg.query(
    `UPDATE ${TABLE}
     SET status = CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancelled' ELSE $2 END,
         result = $3::jsonb, error = $4,
         dead_letter_at = CASE
           WHEN cancel_requested_at IS NOT NULL OR $2 = 'cancelled' THEN NULL
           WHEN $2 IN ('failed', 'interrupted') THEN clock_timestamp()
           ELSE NULL
         END,
         lease_token = NULL, lease_expires_at = NULL,
         finished_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = $1::uuid AND status = 'running' AND lease_token = $5::uuid
       AND lease_expires_at > clock_timestamp()`,
    [
      id,
      status,
      result === undefined ? null : JSON.stringify(result),
      error,
      leaseToken,
    ],
  )
}

async function recoverInterruptedJobs(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE ${TABLE}
     SET status = 'interrupted',
         error = COALESCE(error, 'Queue worker stopped before completion; verify agent state before retrying.'),
         dead_letter_at = COALESCE(dead_letter_at, clock_timestamp()),
         lease_token = NULL, lease_expires_at = NULL,
         finished_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE status = 'running' AND lease_expires_at <= clock_timestamp()`,
  )
}

async function renewJobLease(
  id: string,
  leaseToken: string,
): Promise<{ renewed: boolean; cancelRequested: boolean }> {
  const pg = await ensureSchema()
  const renewed = await pg.query<{ cancel_requested_at: Date | string | null }>(
    `UPDATE ${TABLE}
     SET lease_expires_at = clock_timestamp() + ($3::double precision * interval '1 millisecond'),
         updated_at = clock_timestamp()
     WHERE id = $1::uuid AND status = 'running' AND lease_token = $2::uuid
       AND lease_expires_at > clock_timestamp()
     RETURNING cancel_requested_at`,
    [id, leaseToken, JOB_LEASE_MS],
  )
  return {
    renewed: renewed.rowCount === 1,
    cancelRequested: Boolean(renewed.rows[0]?.cancel_requested_at),
  }
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
    const protectedWork = await client.query(
      `SELECT 1 FROM ${TABLE}
       WHERE status = 'running' AND lease_expires_at > clock_timestamp()
       LIMIT 1`,
    )
    // A previous worker may have lost its Postgres connection (and therefore
    // the advisory lock) while its lease is still valid. Do not overlap it.
    if (protectedWork.rowCount) return

    for (;;) {
      const claimed = await claimNextJob(client)
      if (!claimed) break
      const { job, leaseToken } = claimed
      const controller = new AbortController()
      let heartbeatInFlight = false
      const heartbeat = setInterval(() => {
        if (heartbeatInFlight) return
        heartbeatInFlight = true
        void renewJobLease(job.id, leaseToken)
          .then(({ renewed, cancelRequested }) => {
            if (!renewed) {
              controller.abort('lease-lost')
            } else if (cancelRequested) {
              controller.abort('cancel-requested')
            }
          })
          .catch(() => {
            controller.abort('lease-lost')
          })
          .finally(() => {
            heartbeatInFlight = false
          })
      }, POLL_MS)
      heartbeat.unref()
      let result: unknown = null
      let errorMessage: string | null = null
      let status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted' =
        'succeeded'
      try {
        result = await processor(job.payload, {
          signal: controller.signal,
          jobId: job.id,
        })
        const cancelled = await getSwarmDispatchQueueJob(job.id)
        if (controller.signal.reason === 'lease-lost') {
          status = 'interrupted'
          errorMessage =
            'Worker lease was lost; inspect agent state before retrying.'
        } else if (controller.signal.aborted || cancelled?.cancelRequestedAt) {
          status = 'cancelled'
        } else if (
          result &&
          typeof result === 'object' &&
          Array.isArray((result as { results?: unknown }).results) &&
          (result as { results: Array<{ ok?: unknown }> }).results.some(
            (item) => item.ok !== true,
          )
        ) {
          status = 'failed'
          errorMessage =
            'One or more agent assignments failed; inspect the saved result.'
        }
      } catch {
        status =
          controller.signal.reason === 'lease-lost'
            ? 'interrupted'
            : controller.signal.aborted
              ? 'cancelled'
              : 'failed'
        errorMessage =
          controller.signal.reason === 'lease-lost'
            ? 'Worker lease was lost; inspect agent state before retrying.'
            : controller.signal.aborted
              ? 'Cancellation requested; active dispatch was interrupted.'
              : 'Dispatch failed; inspect the server logs and agent state.'
      } finally {
        clearInterval(heartbeat)
      }
      await finishJob(job.id, leaseToken, status, result, errorMessage)
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
