/**
 * Ops/Cost observability screen — surfaces the cost & routing intelligence that
 * previously lived only in cron scripts + Telegram digests:
 *  - OpenRouter spend (24h / 7d / 30d avg) + credits runway  (Postgres `harp`)
 *  - Per-model session costs, last 7 days                     (gateway state.db)
 *  - Free-model liveness (delisted models the router skips)   (Postgres `harp`)
 *  - Sister escalation shadow rate                            (JSONL log)
 *  - Ops cron job health                                      (cron/jobs.json)
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AiUsagePanel } from './components/ai-usage-panel'
import { AgentControlPlane } from './components/agent-control-plane'

interface CostSummary {
  burn24h: number | null
  burn7d: number | null
  avgDaily30d: number | null
  remaining: number | null
  totalUsed: number | null
  latestSnapshotAt: string | null
}
interface ModelLiveness {
  freshestSeenAt: string | null
  staleFreeModels: Array<{ modelId: string; hoursBehind: number }>
  liveFreeCount: number
}
interface ModelUsageRow {
  model: string
  billing: 'sub' | 'free' | 'paid'
  sessions: number
  billedCostUsd: number
  estCostUsd: number
  tokens: number
}
interface EscalationStats {
  measured: number
  wouldEscalate: number
  ratePct: number
  lastMeasurementAt: string | null
}
interface OpsCronJob {
  id: string
  name: string
  schedule: string
  enabled: boolean
  lastStatus: string | null
  lastRunAt: string | null
  nextRunAt: string | null
}
interface FinanceStorageMonitorSummary {
  statePath: string
  lastCheckedAt: string | null
  lastHealthyAt: string | null
  lastAlertAt: string | null
  consecutiveFailures: number
  lastStatus: string | null
  lastWarnings: Array<string>
  heartbeatAgeMs: number | null
  stale: boolean
}
interface FinanceStorageSmokeCronSummary {
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
interface DeploymentJournalEntry {
  at: string
  commit: string
  previousCommit: string | null
  build: string
  service: string
  canary: string
  releaseSmoke: string
  securityGate: string
  links?: {
    repository?: string | null
    commit?: string | null
    checks?: string | null
    deployment?: string | null
  }
  approval?: {
    status: string
    actor?: string | null
    reference?: string | null
  }
}
interface ServiceHealthHistoryEntry {
  checkedAt: number
  activeState: string
  pid: string
  result: string | null
  residentMemoryKb: number | null
  oomDetected: boolean
  issueCodes: Array<string>
}
interface SafeModeStatus {
  enabled: boolean
  source: 'HERMES_SAFE_MODE' | 'disabled'
  detail: string
}
interface FinanceStorageSmokeCronOutput {
  path: string
  outputAt: string
  runTime: string | null
  status: string | null
  failed: boolean
}
interface HeadroomAgent {
  label: string
  requests: number
  tokensSaved: number
  savingsPercent: number
  topModels: Array<{ model: string; requests: number }>
}
interface HeadroomStats {
  running: true
  apiRequests: number
  requestsCompressed: number
  avgCompressionPct: number
  bestCompressionPct: number
  tokensSaved: number
  tokensBefore: number
  costSavedUsd: number
  savingsPct: number
  agents: Array<HeadroomAgent>
}

interface SystemMetricsPayload {
  process: { uptimeSeconds: number; pid: number }
  api: {
    windowMinutes: number
    requests: number
    errorCount: number
    errorRatePercent: number
    averageLatencyMs: number | null
    p95LatencyMs: number | null
    topRoutes: Array<{
      path: string
      requests: number
      averageLatencyMs: number
    }>
  }
  jobs: {
    totalCronJobs: number | null
    failedCronJobs: number | null
    queueDepth: number | null
    queueRunning: number | null
    queueFailedRecent: number | null
  }
}
interface OpsPayload {
  ok: boolean
  error?: string
  generatedAt: string
  cost: CostSummary | null
  liveness: ModelLiveness | null
  modelUsage7d: Array<ModelUsageRow> | null
  copilotUsage7d: {
    requests24h: number
    requests7d: number
    sessions7d: number
    inputTokens7d: number
    outputTokens7d: number
    aiu7d: number
    lastEventAt: string | null
  } | null
  copilotDailyUsage7d: Array<{
    day: string
    requests: number
    sessions: number
    inputTokens: number
    outputTokens: number
    aiu: number
  }> | null
  hermesDailyUsage7d: Array<{
    day: string
    sessions: number
    tokens: number
    billedCostUsd: number
    estimatedCostUsd: number
  }> | null
  escalation: EscalationStats | null
  cronJobs: Array<OpsCronJob> | null
  financeStorageMonitor: FinanceStorageMonitorSummary | null
  financeStorageSmokeCron: FinanceStorageSmokeCronSummary | null
  deploymentJournal: Array<DeploymentJournalEntry>
  serviceHealthHistory: Array<ServiceHealthHistoryEntry>
  safeMode: SafeModeStatus
  headroom: HeadroomStats | null
}

function money(v: number | null | undefined): string {
  return v == null
    ? '—'
    : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--theme-text)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-[var(--theme-muted)]">{hint}</div>
      ) : null}
    </div>
  )
}

function minutesAgo(ms: number | null): string {
  if (ms == null) return 'unknown'
  if (ms < 60_000) return 'under 1 min ago'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}

function shortFileName(path: string): string {
  return path.split('/').pop() || path
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days > 0
    ? `${days}d ${hours}h`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`
}

function OperationalHealthPanel() {
  const query = useQuery({
    queryKey: ['system-metrics-observability'],
    queryFn: async () => {
      const response = await fetch('/api/system-metrics', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as SystemMetricsPayload
    },
    refetchInterval: 15_000,
  })
  const data = query.data
  return (
    <Panel title="Operational health">
      {query.isPending ? (
        <p className="text-sm text-[var(--theme-muted)]">
          Loading live health…
        </p>
      ) : query.isError || !data ? (
        <p className="text-sm text-[var(--theme-muted)]">
          Live health is unavailable.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile
              label="Uptime"
              value={formatUptime(data.process.uptimeSeconds)}
            />
            <StatTile
              label={`API p95 · ${data.api.windowMinutes}m`}
              value={
                data.api.p95LatencyMs == null
                  ? '—'
                  : `${data.api.p95LatencyMs}ms`
              }
              hint={
                data.api.averageLatencyMs == null
                  ? undefined
                  : `avg ${data.api.averageLatencyMs}ms`
              }
            />
            <StatTile
              label="API errors"
              value={`${data.api.errorRatePercent.toFixed(1)}%`}
              hint={`${data.api.errorCount} / ${data.api.requests} requests`}
            />
            <StatTile
              label="Queue depth"
              value={
                data.jobs.queueDepth == null
                  ? '—'
                  : String(data.jobs.queueDepth)
              }
              hint={
                data.jobs.queueRunning == null
                  ? undefined
                  : `${data.jobs.queueRunning} running`
              }
            />
            <StatTile
              label="Failed jobs"
              value={
                data.jobs.failedCronJobs == null
                  ? '—'
                  : String(data.jobs.failedCronJobs)
              }
              hint={
                data.jobs.queueFailedRecent == null
                  ? undefined
                  : `${data.jobs.queueFailedRecent} queue failures recent`
              }
            />
          </div>
          {data.api.topRoutes.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                Busy API routes
              </div>
              <div className="grid gap-1 text-xs text-[var(--theme-muted)] md:grid-cols-2">
                {data.api.topRoutes.slice(0, 6).map((route) => (
                  <div key={route.path} className="flex justify-between gap-3">
                    <code className="truncate text-[var(--theme-text)]">
                      {route.path}
                    </code>
                    <span className="shrink-0 tabular-nums">
                      {route.requests} · {route.averageLatencyMs}ms avg
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">
        {title}
      </h2>
      {children}
    </section>
  )
}

type ReadinessCheck = { status: string; detail: string }
type ReadinessReport = {
  overall: string
  generatedAt: string
  blockers: Array<string>
  warnings: Array<string>
  checks: Record<string, ReadinessCheck>
}

function ProductionReadinessPanel() {
  const query = useQuery({
    queryKey: ['production-readiness'],
    enabled: false,
    queryFn: async () => {
      const response = await fetch('/api/production-readiness', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = (await response.json()) as {
        ok?: boolean
        error?: string
        report?: ReadinessReport
      }
      if (!response.ok || !data.ok || !data.report)
        throw new Error(data.error || `HTTP ${response.status}`)
      return data.report
    },
  })
  const report = query.data
  return (
    <Panel title="Production readiness report">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--theme-muted)]">
          Runs tests, security-alert checks, migration and encrypted-backup
          evidence, service health, asset integrity, release smoke, and
          deployment-identity verification. Missing external evidence is shown
          as a warning, never as a pass.
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="min-h-10 rounded-lg bg-accent-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {query.isFetching ? 'Running checks…' : 'Run readiness report'}
        </button>
      </div>
      {query.error && (
        <p className="mt-3 text-sm text-[var(--theme-danger)]">
          {query.error instanceof Error
            ? query.error.message
            : 'Readiness report failed.'}
        </p>
      )}
      {report && (
        <div className="mt-4 space-y-3">
          <div
            className={`rounded-lg border p-3 text-sm font-semibold ${report.overall === 'ready' ? 'border-[var(--theme-success)]/40 text-[var(--theme-success)]' : report.overall === 'blocked' ? 'border-[var(--theme-danger)]/40 text-[var(--theme-danger)]' : 'border-[var(--theme-warning)]/40 text-[var(--theme-warning)]'}`}
          >
            Overall: {report.overall} ·{' '}
            {new Date(report.generatedAt).toLocaleString()}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(report.checks).map(([name, check]) => (
              <div
                key={name}
                className="rounded-lg border border-[var(--theme-border)] p-2 text-xs"
              >
                <div className="flex justify-between gap-2 font-semibold">
                  <span>{name}</span>
                  <span
                    className={
                      check.status === 'pass'
                        ? 'text-[var(--theme-success)]'
                        : check.status === 'fail'
                          ? 'text-[var(--theme-danger)]'
                          : 'text-[var(--theme-warning)]'
                    }
                  >
                    {check.status}
                  </span>
                </div>
                <p className="mt-1 text-[var(--theme-muted)]">{check.detail}</p>
              </div>
            ))}
          </div>
          {report.blockers.length > 0 && (
            <p className="text-xs text-[var(--theme-danger)]">
              Blockers: {report.blockers.join(' · ')}
            </p>
          )}
          {report.warnings.length > 0 && (
            <p className="text-xs text-[var(--theme-warning)]">
              Warnings: {report.warnings.join(' · ')}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

export function OpsCostScreen() {
  const [safeModeCommandCopied, setSafeModeCommandCopied] = useState(false)
  const opsQuery = useQuery({
    queryKey: ['ops-observability'],
    queryFn: async () => {
      const res = await fetch('/api/ops-observability', {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as OpsPayload
    },
    refetchInterval: 60_000,
  })

  if (opsQuery.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 overflow-y-auto p-4">
        <header>
          <h1 className="text-lg font-semibold text-[var(--theme-text)]">
            Cost &amp; Routing Observability
          </h1>
          <p className="text-xs text-[var(--theme-muted)]">
            Loading cost and routing metrics…
          </p>
        </header>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="spinner-accent spinner-xl mb-3" />
            <p className="text-sm text-[var(--theme-muted)]">
              Loading ops data…
            </p>
          </div>
        </div>
        <AgentControlPlane />
      </div>
    )
  }
  if (opsQuery.isError || !opsQuery.data.ok) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 overflow-y-auto p-4">
        <header>
          <h1 className="text-lg font-semibold text-[var(--theme-text)]">
            Cost &amp; Routing Observability
          </h1>
          <p className="text-xs text-[var(--theme-muted)]">
            Cost metrics are temporarily unavailable.
          </p>
        </header>
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <p className="text-sm text-[var(--theme-muted)]">
            Failed to load ops data
            {opsQuery.data?.error ? `: ${opsQuery.data.error}` : ''}
          </p>
          <button
            onClick={() => void opsQuery.refetch()}
            className="mt-3 rounded-lg bg-accent-500 px-4 py-2 text-white transition-colors hover:bg-accent-600"
          >
            Retry
          </button>
        </div>
        <AgentControlPlane />
      </div>
    )
  }

  const {
    cost,
    liveness,
    modelUsage7d,
    copilotUsage7d,
    copilotDailyUsage7d,
    hermesDailyUsage7d,
    escalation,
    cronJobs,
    financeStorageMonitor,
    financeStorageSmokeCron,
    deploymentJournal,
    serviceHealthHistory,
    headroom,
    safeMode,
  } = opsQuery.data
  const runwayDays =
    cost?.remaining != null &&
    cost.avgDaily30d != null &&
    cost.avgDaily30d > 0.005
      ? cost.remaining / cost.avgDaily30d
      : null
  const maxCost = Math.max(
    0.0001,
    ...(modelUsage7d ?? []).map((r) => r.billedCostUsd),
  )
  const opsJobs = (cronJobs ?? []).filter((j) =>
    /cost|rollup|scoreboard|post-mortem|discovery|escalation|readiness|pg sync|finance storage monitor smoke/i.test(
      j.name,
    ),
  )
  const visibleSmokeOutputs = financeStorageSmokeCron
    ? Array.from(
        new Map(
          [
            ...financeStorageSmokeCron.recentOutputs.slice(0, 6),
            ...financeStorageSmokeCron.recentOutputs.filter(
              (output) => output.failed,
            ),
          ].map((output) => [output.path, output]),
        ).values(),
      )
    : []

  return (
    <div className="mx-auto max-w-5xl space-y-4 overflow-y-auto p-4">
      <header>
        <h1 className="text-lg font-semibold text-[var(--theme-text)]">
          Cost &amp; Routing Observability
        </h1>
        <p className="text-xs text-[var(--theme-muted)]">
          OpenRouter spend · model liveness · escalation shadow · ops job health
          {cost?.latestSnapshotAt
            ? ` · snapshot ${new Date(cost.latestSnapshotAt).toLocaleString()}`
            : ''}
        </p>
      </header>

      <OperationalHealthPanel />
      <ProductionReadinessPanel />

      <Panel title="External-write safe mode">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={safeMode.enabled ? 'text-amber-400' : 'text-emerald-400'}>
            {safeMode.enabled ? 'ACTIVE — external writes are blocked' : 'DISABLED — normal integration gates apply'}
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText('sudo systemctl set-environment HERMES_SAFE_MODE=1 && sudo systemctl restart hermes-workspace.service')
                .then(() => setSafeModeCommandCopied(true))
                .catch(() => setSafeModeCommandCopied(false))
            }}
            className="rounded-lg border border-[var(--theme-border)] px-2.5 py-1.5 text-xs text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
          >
            {safeModeCommandCopied ? 'Command copied' : 'Copy emergency enable command'}
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">{safeMode.detail}</p>
        <p className="mt-2 text-[11px] text-[var(--theme-muted)]">
          Browser requests never change this process-level control. Run the copied command from an authorized shell, then refresh this panel.
        </p>
      </Panel>

      <Panel title="Production change journal">
        {deploymentJournal.length > 0 ? (
          <div className="space-y-2 text-sm">
            {deploymentJournal.slice(0, 8).map((entry) => (
              <div key={`${entry.at}-${entry.commit}`} className="rounded-lg border border-[var(--theme-border,rgba(128,128,128,0.2))] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-[var(--theme-text)]">{entry.commit.slice(0, 12)}</span>
                  <time className="text-xs text-[var(--theme-muted)]" dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                </div>
                <p className="mt-1 text-xs text-[var(--theme-muted)]">
                  {entry.previousCommit ? `from ${entry.previousCommit.slice(0, 12)} · ` : ''}build {entry.build} · canary {entry.canary} · release {entry.releaseSmoke} · security {entry.securityGate}
                </p>
                <p className="mt-2 flex flex-wrap gap-3 text-xs">
                  {entry.links?.commit ? <a className="text-accent-500 underline" href={entry.links.commit} target="_blank" rel="noreferrer">commit</a> : null}
                  {entry.links?.checks ? <a className="text-accent-500 underline" href={entry.links.checks} target="_blank" rel="noreferrer">checks</a> : null}
                  {entry.links?.deployment ? <a className="text-accent-500 underline" href={entry.links.deployment} target="_blank" rel="noreferrer">deployment</a> : null}
                  {entry.approval ? <span className="text-[var(--theme-muted)]">approval: {entry.approval.status}{entry.approval.actor ? ` · ${entry.approval.actor}` : ''}</span> : null}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--theme-muted)]">No successful deployment entries recorded yet.</p>
        )}
      </Panel>

      <Panel title="Service health history">
        {serviceHealthHistory.length > 0 ? (
          <div className="space-y-1 text-xs">
            {serviceHealthHistory.slice(0, 12).map((sample) => (
              <div key={`${sample.checkedAt}-${sample.pid}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--theme-border,rgba(128,128,128,0.2))] px-2 py-1.5">
                <time dateTime={new Date(sample.checkedAt).toISOString()} className="text-[var(--theme-muted)]">
                  {new Date(sample.checkedAt).toLocaleString()}
                </time>
                <span className={sample.activeState === 'active' && !sample.oomDetected ? 'text-emerald-400' : 'text-[var(--theme-danger)]'}>
                  {sample.activeState} · PID {sample.pid}
                  {sample.oomDetected ? ' · OOM evidence' : ''}
                  {sample.issueCodes.length > 0 ? ` · ${sample.issueCodes.join(', ')}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--theme-muted)]">No persisted monitor samples yet.</p>
        )}
      </Panel>

      {/* Headline stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Spend, last 24h" value={money(cost?.burn24h)} />
        <StatTile label="Spend, last 7d" value={money(cost?.burn7d)} />
        <StatTile
          label="Credits remaining"
          value={money(cost?.remaining)}
          hint={
            cost?.totalUsed != null
              ? `used ${money(cost.totalUsed)} total`
              : undefined
          }
        />
        <StatTile
          label="Runway"
          value={runwayDays == null ? '∞' : `${Math.round(runwayDays)}d`}
          hint={
            cost?.avgDaily30d != null
              ? `at ${money(cost.avgDaily30d)}/day 30d avg`
              : 'at current burn'
          }
        />
      </div>

      <AiUsagePanel
        copilotUsage={copilotUsage7d}
        copilotDailyUsage={copilotDailyUsage7d}
        hermesDailyUsage={hermesDailyUsage7d}
        hermesUsage={
          modelUsage7d
            ? modelUsage7d.reduce(
                (total, row) => ({
                  sessions: total.sessions + row.sessions,
                  tokens: total.tokens + row.tokens,
                }),
                { sessions: 0, tokens: 0 },
              )
            : null
        }
      />

      <AgentControlPlane />

      {/* Headroom context-compression proxy (delegated-subagent OpenRouter traffic) */}
      <Panel title="Context compression — Headroom proxy">
        {headroom == null ? (
          <p className="text-sm text-[var(--theme-muted)]">
            Headroom proxy not running (or unreachable at{' '}
            <code>127.0.0.1:8787</code>). Delegated subagent traffic goes
            direct.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile
                label="Avg compression"
                value={`${headroom.avgCompressionPct.toFixed(1)}%`}
                hint={`best ${headroom.bestCompressionPct.toFixed(0)}%`}
              />
              <StatTile
                label="Tokens saved"
                value={headroom.tokensSaved.toLocaleString()}
                hint={
                  headroom.tokensBefore > 0
                    ? `of ${headroom.tokensBefore.toLocaleString()} sent`
                    : undefined
                }
              />
              <StatTile
                label="Requests compressed"
                value={`${headroom.requestsCompressed} / ${headroom.apiRequests}`}
              />
              <StatTile
                label="Cost saved"
                value={money(headroom.costSavedUsd)}
                hint={
                  headroom.savingsPct > 0
                    ? `${headroom.savingsPct.toFixed(1)}%`
                    : undefined
                }
              />
            </div>
            {headroom.agents.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--theme-muted)]">
                    <th className="pb-2 font-normal">Client</th>
                    <th className="pb-2 font-normal text-right">Requests</th>
                    <th className="pb-2 font-normal text-right">Saved %</th>
                    <th className="pb-2 font-normal text-right">
                      Tokens saved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {headroom.agents.map((a) => (
                    <tr
                      key={a.label}
                      className="border-t border-[var(--theme-border,rgba(128,128,128,0.15))]"
                    >
                      <td className="py-1.5 text-[var(--theme-text)]">
                        {a.label}
                        {a.topModels.length > 0 && (
                          <span className="ml-2 text-xs text-[var(--theme-muted)]">
                            {a.topModels
                              .map((m) => m.model.split('/').pop())
                              .join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {a.requests}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {a.savingsPercent.toFixed(1)}%
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {a.tokensSaved.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Panel>

      {/* Per-model costs (single-series magnitude → table with inline accent bars) */}
      <Panel title="Per-model cost — last 7 days (billed; subscription/free estimates are phantom)">
        {modelUsage7d?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--theme-muted)]">
                <th className="pb-2 font-normal">Model</th>
                <th className="pb-2 font-normal text-right">Billed</th>
                <th className="pb-2 font-normal text-right">Sessions</th>
                <th className="pb-2 font-normal text-right">Tokens</th>
                <th className="pb-2 pl-3 font-normal" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {modelUsage7d.map((r) => (
                <tr
                  key={`${r.model}|${r.billing}`}
                  className="border-t border-[var(--theme-border,rgba(128,128,128,0.15))]"
                >
                  <td className="py-1.5 pr-2 text-[var(--theme-text)]">
                    {r.model.split('/').pop()}
                    <span className="ml-1.5 text-xs text-[var(--theme-muted)]">
                      {r.billing === 'sub'
                        ? '🎫 subscription'
                        : r.billing === 'free'
                          ? 'free'
                          : ''}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--theme-text)]">
                    {money(r.billedCostUsd)}
                    {r.billing !== 'paid' && r.estCostUsd > 0.005 ? (
                      <span className="ml-1 text-xs text-[var(--theme-muted)]">
                        (est {money(r.estCostUsd)})
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--theme-muted)]">
                    {r.sessions}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--theme-muted)]">
                    {(r.tokens / 1000).toFixed(0)}k
                  </td>
                  <td className="py-1.5 pl-3" style={{ width: '30%' }}>
                    <div
                      className="h-2 rounded-[4px] bg-accent-500"
                      style={{
                        width: `${Math.max(2, (r.billedCostUsd / maxCost) * 100)}%`,
                      }}
                      aria-hidden
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[var(--theme-muted)]">
            No session data available.
          </p>
        )}
        <p className="mt-2 text-xs text-[var(--theme-muted)]">
          🎫 Codex subscription is flat-rate — its per-token estimates are not
          billed. Free-tier estimates are likewise phantom. OpenRouter credits
          above are ground truth.
        </p>
      </Panel>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Model liveness */}
        <Panel title="Free-model liveness (router auto-skips stale)">
          {liveness ? (
            <div className="space-y-2 text-sm">
              <p className="text-[var(--theme-text)]">
                ✅ {liveness.liveFreeCount} free models live
                {liveness.freshestSeenAt
                  ? ` · discovery fresh as of ${new Date(liveness.freshestSeenAt).toLocaleString()}`
                  : ''}
              </p>
              {liveness.staleFreeModels.length ? (
                <ul className="space-y-1">
                  {liveness.staleFreeModels.map((m) => (
                    <li key={m.modelId} className="text-[var(--theme-muted)]">
                      ⚰️{' '}
                      <span className="text-[var(--theme-text)]">
                        {m.modelId}
                      </span>{' '}
                      — delisted ({Math.round(m.hoursBehind / 24)}d behind)
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[var(--theme-muted)]">
                  No delisted models detected.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--theme-muted)]">
              Postgres harp unavailable.
            </p>
          )}
        </Panel>

        {/* Escalation shadow */}
        <Panel title="Sister escalation (shadow mode)">
          {escalation ? (
            <div className="space-y-1 text-sm">
              <p className="text-2xl font-semibold tabular-nums text-[var(--theme-text)]">
                {escalation.ratePct}%
                <span className="ml-2 text-sm font-normal text-[var(--theme-muted)]">
                  would escalate
                </span>
              </p>
              <p className="text-[var(--theme-muted)]">
                {escalation.wouldEscalate} of {escalation.measured} live
                delegations measured
                {escalation.lastMeasurementAt
                  ? ` · last ${new Date(escalation.lastMeasurementAt).toLocaleDateString()}`
                  : ''}
              </p>
            </div>
          ) : (
            <p className="text-sm text-[var(--theme-muted)]">
              No escalation measurements yet.
            </p>
          )}
        </Panel>

        {/* Finance storage monitor */}
        <Panel title="Finance storage mirror">
          {financeStorageMonitor ? (
            <div className="space-y-2 text-sm">
              <p className="text-2xl font-semibold tabular-nums text-[var(--theme-text)]">
                {financeStorageMonitor.lastStatus ?? 'unknown'}
              </p>
              <p className="text-[var(--theme-muted)]">
                Heartbeat {minutesAgo(financeStorageMonitor.heartbeatAgeMs)}
                {financeStorageMonitor.stale ? ' · stale' : ''}
              </p>
              <p className="text-[var(--theme-muted)]">
                Failures: {financeStorageMonitor.consecutiveFailures}
                {financeStorageMonitor.lastHealthyAt
                  ? ` · healthy ${new Date(financeStorageMonitor.lastHealthyAt).toLocaleString()}`
                  : ''}
              </p>
              {financeStorageMonitor.lastWarnings.length > 0 ? (
                <ul className="space-y-1 text-[var(--theme-muted)]">
                  {financeStorageMonitor.lastWarnings
                    .slice(0, 3)
                    .map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                </ul>
              ) : (
                <p className="text-[var(--theme-muted)]">No mirror warnings.</p>
              )}
              <div className="border-t border-[var(--theme-border,rgba(128,128,128,0.15))] pt-2">
                <p className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                  Smoke cron
                </p>
                {financeStorageSmokeCron ? (
                  <div className="mt-1 space-y-1">
                    <p className="text-[var(--theme-text)]">
                      {financeStorageSmokeCron.enabled ? 'Enabled' : 'Paused'} ·{' '}
                      {financeStorageSmokeCron.lastStatus ?? 'not yet run'}
                    </p>
                    <p className="text-[var(--theme-muted)]">
                      Schedule{' '}
                      <span className="font-mono">
                        {financeStorageSmokeCron.schedule || 'unknown'}
                      </span>
                      {financeStorageSmokeCron.completedRuns != null
                        ? ` · ${financeStorageSmokeCron.completedRuns} run(s)`
                        : ''}
                    </p>
                    <p className="text-[var(--theme-muted)]">
                      Last:{' '}
                      {financeStorageSmokeCron.lastRunAt
                        ? new Date(
                            financeStorageSmokeCron.lastRunAt,
                          ).toLocaleString()
                        : 'none'}{' '}
                      · Next:{' '}
                      {financeStorageSmokeCron.nextRunAt
                        ? new Date(
                            financeStorageSmokeCron.nextRunAt,
                          ).toLocaleString()
                        : 'none'}
                    </p>
                    {financeStorageSmokeCron.latestOutputStatus ? (
                      <p className="text-[var(--theme-muted)]">
                        Artifact: {financeStorageSmokeCron.latestOutputStatus}
                      </p>
                    ) : null}
                    {financeStorageSmokeCron.recentOutputs.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        <p className="text-[var(--theme-muted)]">
                          Recent artifacts:{' '}
                          {financeStorageSmokeCron.recentFailureCount > 0
                            ? `${financeStorageSmokeCron.recentFailureCount} failure(s) in last ${financeStorageSmokeCron.recentOutputs.length}`
                            : `last ${financeStorageSmokeCron.recentOutputs.length} clean`}
                        </p>
                        <ul className="space-y-1 text-xs">
                          {visibleSmokeOutputs.map((output) => (
                            <li
                              key={output.path}
                              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--theme-muted)]"
                            >
                              <span
                                className={
                                  output.failed
                                    ? 'font-medium text-[var(--theme-text)]'
                                    : 'text-[var(--theme-muted)]'
                                }
                              >
                                {output.failed ? 'failed' : 'ok'}
                              </span>
                              <span>
                                {output.runTime ??
                                  new Date(output.outputAt).toLocaleString()}
                              </span>
                              <span className="font-mono">
                                {shortFileName(output.path)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {financeStorageSmokeCron.lastError ||
                    financeStorageSmokeCron.lastDeliveryError ? (
                      <p className="text-[var(--theme-text)]">
                        {financeStorageSmokeCron.lastError ??
                          financeStorageSmokeCron.lastDeliveryError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 text-[var(--theme-muted)]">
                    Smoke cron job not registered.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--theme-muted)]">
              No finance monitor heartbeat yet.
            </p>
          )}
        </Panel>
      </div>

      {/* Ops cron job health */}
      <Panel title="Ops cron jobs">
        {opsJobs.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--theme-muted)]">
                <th className="pb-2 font-normal">Job</th>
                <th className="pb-2 font-normal">Schedule</th>
                <th className="pb-2 font-normal">Status</th>
                <th className="pb-2 font-normal">Next run</th>
              </tr>
            </thead>
            <tbody>
              {opsJobs.map((j) => (
                <tr
                  key={j.id}
                  className="border-t border-[var(--theme-border,rgba(128,128,128,0.15))]"
                >
                  <td className="py-1.5 pr-2 text-[var(--theme-text)]">
                    {j.name}
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-xs text-[var(--theme-muted)]">
                    {j.schedule}
                  </td>
                  <td className="py-1.5 pr-2">
                    {!j.enabled ? (
                      <span className="text-[var(--theme-muted)]">
                        ⏸ paused
                      </span>
                    ) : j.lastStatus === 'ok' ? (
                      <span className="text-[var(--theme-text)]">✅ ok</span>
                    ) : j.lastStatus == null ? (
                      <span className="text-[var(--theme-muted)]">
                        🕐 not yet run
                      </span>
                    ) : (
                      <span className="text-[var(--theme-text)]">
                        ❌ {j.lastStatus}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-xs text-[var(--theme-muted)]">
                    {j.nextRunAt ? new Date(j.nextRunAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[var(--theme-muted)]">
            No ops cron jobs found.
          </p>
        )}
      </Panel>
    </div>
  )
}
