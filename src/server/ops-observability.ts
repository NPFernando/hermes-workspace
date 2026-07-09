/**
 * Ops/Cost observability — server-only aggregator for the /ops-cost screen.
 *
 * Sources (all read-only):
 *  - Postgres `harp` db (kept live-fresh hourly by ~/.hermes/scripts/harp-pg-sync.sh):
 *    OpenRouter spend snapshots + model liveness.
 *  - Gateway session store ~/.hermes/state.db (SQLite): per-model cost/token usage.
 *  - ~/.hermes/sister-escalations.jsonl: sister escalation shadow measurements.
 *  - ~/.hermes/cron/jobs.json: ops cron job health.
 *  - ~/.hermes/finance/storage-monitor.json: Finance JSON/Postgres mirror health.
 *
 * No new npm deps: queries shell out to the psql / sqlite3 CLIs (child_process is
 * already used by 20+ server modules). Each section is independently try/caught so
 * one failing source degrades to `null` instead of failing the whole payload.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  FINANCE_STORAGE_MONITOR_STATE_PATH,
  readFinanceStorageMonitorState,
} from './finance-storage-monitor'

const execFileAsync = promisify(execFile)

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')

const PSQL_CANDIDATES = [
  '/home/ubuntu/.pg0/installation/18.1.0/bin/psql',
  'psql', // PATH fallback
]

const FINANCE_STORAGE_HEARTBEAT_STALE_MS = 30 * 60_000
const FINANCE_STORAGE_SMOKE_CRON_JOB_ID = 'finance-storage-monitor-smoke'

/** Read HERMES_PG_* connection settings from process.env, falling back to ~/.hermes/.env. */
function pgConn(): { url: string } | null {
  let password = process.env.HERMES_PG_PASSWORD
  let host = process.env.HERMES_PG_HOST ?? '127.0.0.1'
  let port = process.env.HERMES_PG_PORT ?? '5432'
  let user = process.env.HERMES_PG_USER ?? 'hermes_app'
  if (!password) {
    try {
      const env = readFileSync(join(HERMES_HOME, '.env'), 'utf8')
      for (const line of env.split('\n')) {
        const m = line.match(/^HERMES_PG_(PASSWORD|HOST|PORT|USER)=(.*)$/)
        if (!m) continue
        const v = m[2].trim().replace(/^"|"$/g, '')
        if (m[1] === 'PASSWORD') password = v
        else if (m[1] === 'HOST') host = v
        else if (m[1] === 'PORT') port = v
        else if (m[1] === 'USER') user = v
      }
    } catch {
      return null
    }
  }
  if (!password) return null
  return {
    url: `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/harp`,
  }
}

/** Run a SQL query against the Postgres harp db; the query must return ONE row/col of JSON. */
async function pgJson<T>(sql: string): Promise<T | null> {
  const conn = pgConn()
  if (!conn) return null
  for (const psql of PSQL_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(
        psql,
        [conn.url, '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
        { timeout: 15_000 },
      )
      const text = stdout.trim()
      return text ? (JSON.parse(text) as T) : null
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue // try next candidate
      return null
    }
  }
  return null
}

/** Run a SQL query against a SQLite db via the sqlite3 CLI in -json mode. */
async function sqliteJson<T>(dbPath: string, sql: string): Promise<T | null> {
  if (!existsSync(dbPath)) return null
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/sqlite3',
      ['-json', '-readonly', dbPath, sql],
      { timeout: 15_000 },
    )
    const text = stdout.trim()
    return text ? (JSON.parse(text) as T) : ([] as unknown as T)
  } catch {
    return null
  }
}

// ── Section: OpenRouter spend (Postgres harp) ───────────────────────────────

export interface CostSummary {
  burn24h: number | null
  burn7d: number | null
  avgDaily30d: number | null
  remaining: number | null
  totalUsed: number | null
  latestSnapshotAt: string | null
}

async function getCostSummary(): Promise<CostSummary | null> {
  type Row = {
    usage_now: number | null
    usage_24h: number | null
    usage_7d: number | null
    usage_30d: number | null
    remaining: number | null
    latest: string | null
  }
  const row = await pgJson<Row>(`
    SELECT row_to_json(t) FROM (
      SELECT
        (SELECT usage_usd FROM openrouter_key_snapshots WHERE usage_usd IS NOT NULL
           ORDER BY captured_at DESC LIMIT 1) AS usage_now,
        (SELECT usage_usd FROM openrouter_key_snapshots WHERE usage_usd IS NOT NULL
           AND captured_at::timestamptz <= now() - interval '24 hours'
           ORDER BY captured_at DESC LIMIT 1) AS usage_24h,
        (SELECT usage_usd FROM openrouter_key_snapshots WHERE usage_usd IS NOT NULL
           AND captured_at::timestamptz <= now() - interval '7 days'
           ORDER BY captured_at DESC LIMIT 1) AS usage_7d,
        (SELECT usage_usd FROM openrouter_key_snapshots WHERE usage_usd IS NOT NULL
           AND captured_at::timestamptz <= now() - interval '30 days'
           ORDER BY captured_at DESC LIMIT 1) AS usage_30d,
        (SELECT limit_remaining_usd FROM openrouter_key_snapshots
           WHERE limit_remaining_usd IS NOT NULL ORDER BY captured_at DESC LIMIT 1) AS remaining,
        (SELECT max(captured_at) FROM openrouter_key_snapshots) AS latest
    ) t`)
  if (!row || row.usage_now == null) return null
  const burn = (then: number | null) =>
    then == null
      ? null
      : Math.max(0, Math.round((row.usage_now! - then) * 10000) / 10000)
  const burn30 = burn(row.usage_30d)
  return {
    burn24h: burn(row.usage_24h),
    burn7d: burn(row.usage_7d),
    avgDaily30d:
      burn30 == null ? null : Math.round((burn30 / 30) * 10000) / 10000,
    remaining: row.remaining,
    totalUsed: row.usage_now,
    latestSnapshotAt: row.latest,
  }
}

// ── Section: model liveness (Postgres harp) ─────────────────────────────────

export interface ModelLiveness {
  freshestSeenAt: string | null
  staleFreeModels: Array<{ modelId: string; hoursBehind: number }>
  liveFreeCount: number
}

async function getModelLiveness(): Promise<ModelLiveness | null> {
  type Row = {
    freshest: string | null
    stale: Array<{ model_id: string; hrs: number }> | null
    live_free: number
  }
  const row = await pgJson<Row>(`
    SELECT row_to_json(t) FROM (
      WITH mx AS (SELECT max(last_seen_at::timestamptz) AS m FROM models)
      SELECT
        (SELECT m::text FROM mx) AS freshest,
        (SELECT json_agg(json_build_object(
             'model_id', model_id,
             'hrs', round(extract(epoch FROM (SELECT m FROM mx) - last_seen_at::timestamptz) / 3600)))
           FROM models
           WHERE cost_tier = 'free' AND last_seen_at IS NOT NULL
             AND (SELECT m FROM mx) - last_seen_at::timestamptz > interval '72 hours') AS stale,
        (SELECT count(*) FROM models
           WHERE cost_tier = 'free' AND last_seen_at IS NOT NULL
             AND (SELECT m FROM mx) - last_seen_at::timestamptz <= interval '72 hours')::int AS live_free
    ) t`)
  if (!row) return null
  return {
    freshestSeenAt: row.freshest,
    staleFreeModels: (row.stale ?? []).map((s) => ({
      modelId: s.model_id,
      hoursBehind: s.hrs,
    })),
    liveFreeCount: row.live_free,
  }
}

// ── Section: per-model session costs (gateway state.db, SQLite) ─────────────

export interface ModelUsageRow {
  model: string
  /** 'sub' = Codex subscription (flat-rate), 'free' = :free tier, 'paid' = per-call billed */
  billing: 'sub' | 'free' | 'paid'
  sessions: number
  /** Real billable cost: $0 for subscription/free rows (their estimates are phantom). */
  billedCostUsd: number
  /** Raw HARP estimate — phantom for sub/free rows, kept for reference. */
  estCostUsd: number
  tokens: number
}

async function getSessionModelCosts(
  days = 7,
): Promise<Array<ModelUsageRow> | null> {
  const rows = await sqliteJson<
    Array<{
      model: string | null
      bill: string
      sessions: number
      billed: number | null
      est: number | null
      toks: number | null
    }>
  >(
    join(HERMES_HOME, 'state.db'),
    `SELECT COALESCE(model,'(unknown)') AS model,
            CASE WHEN billing_provider='openai-codex' THEN 'sub'
                 WHEN COALESCE(model,'') LIKE '%:free%' THEN 'free'
                 ELSE 'paid' END AS bill,
            COUNT(*) AS sessions,
            ROUND(SUM(CASE WHEN billing_provider='openai-codex'
                             OR COALESCE(model,'') LIKE '%:free%' THEN 0
                           ELSE COALESCE(actual_cost_usd, estimated_cost_usd, 0) END), 4) AS billed,
            ROUND(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 4) AS est,
            SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)) AS toks
     FROM sessions WHERE started_at >= strftime('%s','now','-${Math.max(1, Math.floor(days))} days')
     GROUP BY model, bill ORDER BY billed DESC, sessions DESC LIMIT 10`,
  )
  if (!rows) return null
  return rows.map((r) => ({
    model: r.model ?? '(unknown)',
    billing: r.bill === 'sub' || r.bill === 'free' ? r.bill : 'paid',
    sessions: r.sessions,
    billedCostUsd: r.billed ?? 0,
    estCostUsd: r.est ?? 0,
    tokens: r.toks ?? 0,
  }))
}

// ── Section: sister escalation shadow (JSONL) ───────────────────────────────

export interface EscalationStats {
  measured: number
  wouldEscalate: number
  ratePct: number
  lastMeasurementAt: string | null
}

function getEscalationStats(): EscalationStats | null {
  const path = join(HERMES_HOME, 'sister-escalations.jsonl')
  if (!existsSync(path)) return null
  try {
    let measured = 0
    let would = 0
    let last: string | null = null
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line) as {
          mode?: string
          would_escalate?: boolean
          at?: string
        }
        if (r.mode !== 'shadow-live') continue
        measured += 1
        if (r.would_escalate) would += 1
        if (r.at) last = r.at
      } catch {
        /* skip bad line */
      }
    }
    return {
      measured,
      wouldEscalate: would,
      ratePct: measured ? Math.round((would / measured) * 100) : 0,
      lastMeasurementAt: last,
    }
  } catch {
    return null
  }
}

// ── Section: ops cron jobs (jobs.json) ──────────────────────────────────────

export interface OpsCronJob {
  id: string
  name: string
  schedule: string
  enabled: boolean
  lastStatus: string | null
  lastRunAt: string | null
  nextRunAt: string | null
}

type CronJobRecord = Record<string, unknown>

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readCronJobsFile(path: string): Array<CronJobRecord> | null {
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as {
      jobs?: Array<CronJobRecord>
    }
    return Array.isArray(data.jobs) ? data.jobs : []
  } catch {
    return null
  }
}

function getOpsCronJobs(): Array<OpsCronJob> | null {
  const path = join(HERMES_HOME, 'cron', 'jobs.json')
  const jobs = readCronJobsFile(path)
  if (!jobs) return null
  return jobs.map((j) => ({
    id: String(j.id ?? ''),
    name: String(j.name ?? ''),
    schedule: String((j.schedule as { expr?: string } | undefined)?.expr ?? ''),
    enabled: Boolean(j.enabled),
    lastStatus: readString(j.last_status),
    lastRunAt: readString(j.last_run_at),
    nextRunAt: readString(j.next_run_at),
  }))
}

export interface FinanceStorageSmokeCronSummary {
  jobId: string
  name: string
  schedule: string
  enabled: boolean
  state: string | null
  lastStatus: string | null
  lastRunAt: string | null
  lastError: string | null
  lastDeliveryError: string | null
  nextRunAt: string | null
  completedRuns: number | null
  deliver: string | null
  latestOutputPath: string | null
  latestOutputAt: string | null
  latestOutputStatus: string | null
  recentOutputs: Array<FinanceStorageSmokeCronOutput>
  recentFailureCount: number
}

export interface FinanceStorageSmokeCronOutput {
  path: string
  outputAt: string
  runTime: string | null
  status: string | null
  failed: boolean
}

function readCronOutputArtifacts(
  outputDir: string,
  limit: number,
): Array<FinanceStorageSmokeCronOutput> {
  if (!existsSync(outputDir)) return []
  try {
    return readdirSync(outputDir)
      .map((fileName) => {
        const path = join(outputDir, fileName)
        const stat = statSync(path)
        return stat.isFile() ? { path, mtimeMs: stat.mtimeMs } : null
      })
      .filter((entry): entry is { path: string; mtimeMs: number } =>
        Boolean(entry),
      )
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, Math.max(1, limit))
      .map((entry) => {
        const body = readFileSync(entry.path, 'utf8')
        const statusMatch = body.match(/^\*\*Status:\*\*\s*(.+)$/m)
        const runTimeMatch = body.match(/^\*\*Run Time:\*\*\s*(.+)$/m)
        const failed = /\bfinance-storage-monitor-smoke FAILED\b/.test(body)
        return {
          path: entry.path,
          outputAt: new Date(entry.mtimeMs).toISOString(),
          runTime: runTimeMatch?.[1]?.trim() ?? null,
          status: failed ? 'failed' : (statusMatch?.[1]?.trim() ?? null),
          failed,
        }
      })
  } catch {
    return []
  }
}

export function getFinanceStorageSmokeCronSummary(
  options: {
    jobsPath?: string
    outputDir?: string
    jobId?: string
    recentOutputLimit?: number
  } = {},
): FinanceStorageSmokeCronSummary | null {
  const jobId = options.jobId ?? FINANCE_STORAGE_SMOKE_CRON_JOB_ID
  const jobsPath = options.jobsPath ?? join(HERMES_HOME, 'cron', 'jobs.json')
  const jobs = readCronJobsFile(jobsPath)
  if (!jobs) return null
  const job = jobs.find((candidate) => readString(candidate.id) === jobId)
  if (!job) return null
  const schedule = job.schedule as { expr?: string; display?: string } | null
  const repeat = job.repeat as { completed?: unknown } | null
  const completed =
    typeof repeat?.completed === 'number' && Number.isFinite(repeat.completed)
      ? repeat.completed
      : null
  const recentOutputs = readCronOutputArtifacts(
    options.outputDir ?? join(HERMES_HOME, 'cron', 'output', jobId),
    options.recentOutputLimit ?? 12,
  )
  const latestOutput = recentOutputs.at(0) ?? null
  return {
    jobId,
    name: readString(job.name) ?? jobId,
    schedule: readString(schedule?.expr) ?? readString(schedule?.display) ?? '',
    enabled: Boolean(job.enabled),
    state: readString(job.state),
    lastStatus: readString(job.last_status),
    lastRunAt: readString(job.last_run_at),
    lastError: readString(job.last_error),
    lastDeliveryError: readString(job.last_delivery_error),
    nextRunAt: readString(job.next_run_at),
    completedRuns: completed,
    deliver: readString(job.deliver),
    latestOutputPath: latestOutput?.path ?? null,
    latestOutputAt: latestOutput?.outputAt ?? null,
    latestOutputStatus: latestOutput?.status ?? null,
    recentOutputs,
    recentFailureCount: recentOutputs.filter((output) => output.failed).length,
  }
}

// ── Section: Finance storage mirror monitor ────────────────────────────────

export interface FinanceStorageMonitorSummary {
  statePath: string
  lastCheckedAt: string | null
  lastHealthyAt: string | null
  lastAlertAt: string | null
  consecutiveFailures: number
  lastStatus: string | null
  lastWarnings: Array<string>
  lastSelfHealAttempts: number
  lastSelfHealSucceeded: boolean | null
  heartbeatAgeMs: number | null
  stale: boolean
}

function parseTimestampMs(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function getFinanceStorageMonitorSummary(
  options: {
    statePath?: string
    now?: Date
    staleAfterMs?: number
  } = {},
): FinanceStorageMonitorSummary | null {
  const statePath = options.statePath ?? FINANCE_STORAGE_MONITOR_STATE_PATH
  if (!existsSync(statePath)) return null
  const state = readFinanceStorageMonitorState(statePath)
  const checkedMs = parseTimestampMs(state.lastCheckedAt)
  const nowMs = (options.now ?? new Date()).getTime()
  const heartbeatAgeMs =
    checkedMs === null ? null : Math.max(0, nowMs - checkedMs)
  const staleAfterMs =
    typeof options.staleAfterMs === 'number' &&
    Number.isFinite(options.staleAfterMs) &&
    options.staleAfterMs > 0
      ? options.staleAfterMs
      : FINANCE_STORAGE_HEARTBEAT_STALE_MS
  return {
    statePath,
    lastCheckedAt: state.lastCheckedAt,
    lastHealthyAt: state.lastHealthyAt,
    lastAlertAt: state.lastAlertAt,
    consecutiveFailures: state.consecutiveFailures,
    lastStatus: state.lastStatus,
    lastWarnings: state.lastWarnings,
    lastSelfHealAttempts: state.lastSelfHealAttempts,
    lastSelfHealSucceeded: state.lastSelfHealSucceeded,
    heartbeatAgeMs,
    stale: heartbeatAgeMs === null || heartbeatAgeMs > staleAfterMs,
  }
}

// ── Aggregate payload ────────────────────────────────────────────────────────

export interface OpsObservability {
  generatedAt: string
  cost: CostSummary | null
  liveness: ModelLiveness | null
  modelUsage7d: Array<ModelUsageRow> | null
  escalation: EscalationStats | null
  cronJobs: Array<OpsCronJob> | null
  financeStorageMonitor: FinanceStorageMonitorSummary | null
  financeStorageSmokeCron: FinanceStorageSmokeCronSummary | null
}

export async function getOpsObservability(): Promise<OpsObservability> {
  const [cost, liveness, modelUsage7d] = await Promise.all([
    getCostSummary().catch(() => null),
    getModelLiveness().catch(() => null),
    getSessionModelCosts(7).catch(() => null),
  ])
  return {
    generatedAt: new Date().toISOString(),
    cost,
    liveness,
    modelUsage7d,
    escalation: getEscalationStats(),
    cronJobs: getOpsCronJobs(),
    financeStorageMonitor: getFinanceStorageMonitorSummary(),
    financeStorageSmokeCron: getFinanceStorageSmokeCronSummary(),
  }
}
