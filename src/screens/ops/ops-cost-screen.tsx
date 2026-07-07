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
interface OpsPayload {
  ok: boolean
  error?: string
  generatedAt: string
  cost: CostSummary | null
  liveness: ModelLiveness | null
  modelUsage7d: Array<ModelUsageRow> | null
  escalation: EscalationStats | null
  cronJobs: Array<OpsCronJob> | null
}

function money(v: number | null | undefined): string {
  return v == null ? '—' : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--theme-text)]">{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--theme-muted)]">{hint}</div> : null}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">{title}</h2>
      {children}
    </section>
  )
}

export function OpsCostScreen() {
  const opsQuery = useQuery({
    queryKey: ['ops-observability'],
    queryFn: async () => {
      const res = await fetch('/api/ops-observability', { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as OpsPayload
    },
    refetchInterval: 60_000,
  })

  if (opsQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="spinner-accent spinner-xl mb-3" />
          <p className="text-sm text-[var(--theme-muted)]">Loading ops data…</p>
        </div>
      </div>
    )
  }
  if (opsQuery.isError || !opsQuery.data.ok) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
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
    )
  }

  const { cost, liveness, modelUsage7d, escalation, cronJobs } = opsQuery.data
  const runwayDays =
    cost?.remaining != null && cost.avgDaily30d != null && cost.avgDaily30d > 0.005
      ? cost.remaining / cost.avgDaily30d
      : null
  const maxCost = Math.max(0.0001, ...(modelUsage7d ?? []).map((r) => r.billedCostUsd))
  const opsJobs = (cronJobs ?? []).filter((j) =>
    /cost|rollup|scoreboard|post-mortem|discovery|escalation|readiness|pg sync/i.test(j.name),
  )

  return (
    <div className="mx-auto max-w-5xl space-y-4 overflow-y-auto p-4">
      <header>
        <h1 className="text-lg font-semibold text-[var(--theme-text)]">Cost &amp; Routing Observability</h1>
        <p className="text-xs text-[var(--theme-muted)]">
          OpenRouter spend · model liveness · escalation shadow · ops job health
          {cost?.latestSnapshotAt ? ` · snapshot ${new Date(cost.latestSnapshotAt).toLocaleString()}` : ''}
        </p>
      </header>

      {/* Headline stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Spend, last 24h" value={money(cost?.burn24h)} />
        <StatTile label="Spend, last 7d" value={money(cost?.burn7d)} />
        <StatTile
          label="Credits remaining"
          value={money(cost?.remaining)}
          hint={cost?.totalUsed != null ? `used ${money(cost.totalUsed)} total` : undefined}
        />
        <StatTile
          label="Runway"
          value={runwayDays == null ? '∞' : `${Math.round(runwayDays)}d`}
          hint={cost?.avgDaily30d != null ? `at ${money(cost.avgDaily30d)}/day 30d avg` : 'at current burn'}
        />
      </div>

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
                      {r.billing === 'sub' ? '🎫 subscription' : r.billing === 'free' ? 'free' : ''}
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
                  <td className="py-1.5 text-right tabular-nums text-[var(--theme-muted)]">{r.sessions}</td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--theme-muted)]">
                    {(r.tokens / 1000).toFixed(0)}k
                  </td>
                  <td className="py-1.5 pl-3" style={{ width: '30%' }}>
                    <div
                      className="h-2 rounded-[4px] bg-accent-500"
                      style={{ width: `${Math.max(2, (r.billedCostUsd / maxCost) * 100)}%` }}
                      aria-hidden
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[var(--theme-muted)]">No session data available.</p>
        )}
        <p className="mt-2 text-xs text-[var(--theme-muted)]">
          🎫 Codex subscription is flat-rate — its per-token estimates are not billed. Free-tier
          estimates are likewise phantom. OpenRouter credits above are ground truth.
        </p>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
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
                      ⚰️ <span className="text-[var(--theme-text)]">{m.modelId}</span> — delisted (
                      {Math.round(m.hoursBehind / 24)}d behind)
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[var(--theme-muted)]">No delisted models detected.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--theme-muted)]">Postgres harp unavailable.</p>
          )}
        </Panel>

        {/* Escalation shadow */}
        <Panel title="Sister escalation (shadow mode)">
          {escalation ? (
            <div className="space-y-1 text-sm">
              <p className="text-2xl font-semibold tabular-nums text-[var(--theme-text)]">
                {escalation.ratePct}%
                <span className="ml-2 text-sm font-normal text-[var(--theme-muted)]">would escalate</span>
              </p>
              <p className="text-[var(--theme-muted)]">
                {escalation.wouldEscalate} of {escalation.measured} live delegations measured
                {escalation.lastMeasurementAt
                  ? ` · last ${new Date(escalation.lastMeasurementAt).toLocaleDateString()}`
                  : ''}
              </p>
            </div>
          ) : (
            <p className="text-sm text-[var(--theme-muted)]">No escalation measurements yet.</p>
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
                <tr key={j.id} className="border-t border-[var(--theme-border,rgba(128,128,128,0.15))]">
                  <td className="py-1.5 pr-2 text-[var(--theme-text)]">{j.name}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs text-[var(--theme-muted)]">{j.schedule}</td>
                  <td className="py-1.5 pr-2">
                    {!j.enabled ? (
                      <span className="text-[var(--theme-muted)]">⏸ paused</span>
                    ) : j.lastStatus === 'ok' ? (
                      <span className="text-[var(--theme-text)]">✅ ok</span>
                    ) : j.lastStatus == null ? (
                      <span className="text-[var(--theme-muted)]">🕐 not yet run</span>
                    ) : (
                      <span className="text-[var(--theme-text)]">❌ {j.lastStatus}</span>
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
          <p className="text-sm text-[var(--theme-muted)]">No ops cron jobs found.</p>
        )}
      </Panel>
    </div>
  )
}
