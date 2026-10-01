import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

type UsageLine = {
  type: 'progress' | 'text' | 'badge'
  label: string
  measure?: 'quota' | 'usage' | 'spend' | 'balance' | 'availability'
  used?: number
  limit?: number
  format?: 'percent' | 'dollars' | 'tokens'
  value?: string
  color?: string
  resetsAt?: string
}

type ProviderUsage = {
  provider: string
  displayName: string
  status: 'ok' | 'missing_credentials' | 'auth_expired' | 'error'
  message?: string
  plan?: string
  source?: string
  sourceKind?: 'provider_api' | 'local_auth' | 'credential_check'
  lines: Array<UsageLine>
  updatedAt: number
}

type ProviderUsageResponse = {
  ok: boolean
  degraded?: boolean
  updatedAt: number
  providers: Array<ProviderUsage>
  history?: Array<UsageHistoryPoint>
  sharedBudget?: {
    level:
      'unconfigured' | 'no_data' | 'ok' | 'warning' | 'critical' | 'exhausted'
    limitUsd: number | null
    usedUsd: number | null
    remainingUsd: number | null
    percentUsed: number | null
    message: string
  }
  monthlyBudget?: {
    level:
      'unconfigured' | 'no_data' | 'ok' | 'warning' | 'critical' | 'exhausted'
    limitUsd: number | null
    usedUsd: number | null
    remainingUsd: number | null
    percentUsed: number | null
    periodDays: number
    message: string
  }
  anomalies?: Array<{
    provider: string
    displayName: string
    label: string
    measure: 'quota' | 'spend'
    day: string
    used: number
    baseline: number
    ratio: number
    severity: 'warning' | 'critical'
    message: string
  }>
  error?: string
}

type UsageHistoryPoint = {
  day: string
  provider: string
  displayName: string
  label: string
  measure: 'quota' | 'spend'
  used: number
  limit: number | null
  percent: number | null
  sampledAt: number
  source: string | null
}

type HermesModelUsage = {
  sessions: number
  tokens: number
}

type CopilotUsage = {
  requests24h: number
  requests7d: number
  sessions7d: number
  inputTokens7d: number
  outputTokens7d: number
  aiu7d: number
  lastEventAt: string | null
}

type CopilotDailyUsage = {
  day: string
  requests: number
  sessions: number
  inputTokens: number
  outputTokens: number
  aiu: number
}

type HermesDailyUsage = {
  day: string
  sessions: number
  tokens: number
  billedCostUsd: number
  estimatedCostUsd: number
}

export type QuotaAlert = 'limit' | 'critical' | 'warning' | null

export function providerFreshness(
  updatedAt: number,
  now = Date.now(),
): 'current' | 'stale' {
  return now - updatedAt <= 10 * 60_000 ? 'current' : 'stale'
}

export function quotaAlert(line: UsageLine): QuotaAlert {
  if (
    line.type !== 'progress' ||
    (line.measure !== 'quota' && line.measure !== 'spend') ||
    line.used === undefined ||
    line.limit === undefined ||
    line.limit <= 0
  ) {
    return null
  }

  const percent = (line.used / line.limit) * 100
  if (percent >= 100) return 'limit'
  if (percent >= 90) return 'critical'
  if (percent >= 75) return 'warning'
  return null
}

export function lastSevenUtcDays(now = Date.now()): Array<string> {
  const today = new Date(now)
  const days: Array<string> = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - offset,
      ),
    )
    days.push(date.toISOString().slice(0, 10))
  }
  return days
}

export function lastThirtyOneUtcDays(now = Date.now()): Array<string> {
  const today = new Date(now)
  const days: Array<string> = []
  for (let offset = 30; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - offset,
      ),
    )
    days.push(date.toISOString().slice(0, 10))
  }
  return days
}

function DailyTrendCard({
  title,
  unit,
  days,
  values,
  formatValue,
}: {
  title: string
  unit: string
  days: Array<string>
  values: Map<string, number>
  formatValue: (value: number) => string
}) {
  const maximum = Math.max(1, ...values.values())
  return (
    <article className="rounded-lg border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-3">
      <h3 className="text-xs font-medium text-[var(--theme-text)]">{title}</h3>
      <p className="text-[10px] text-[var(--theme-muted)]">{unit}</p>
      <div className="mt-3 overflow-x-auto" aria-label={`${title}, history`}>
        <div
          className="grid min-w-full items-end gap-1"
          style={{
            gridTemplateColumns: `repeat(${days.length}, minmax(28px, 1fr))`,
          }}
        >
          {days.map((day) => {
            const value = values.get(day)
            const height =
              value === undefined ? 0 : Math.max(4, (value / maximum) * 48)
            return (
              <div
                key={day}
                className="flex min-w-0 flex-col items-center gap-1"
              >
                <span className="max-w-full truncate text-[9px] tabular-nums text-[var(--theme-muted)]">
                  {value === undefined ? '—' : formatValue(value)}
                </span>
                <div className="flex h-12 w-full items-end rounded bg-[var(--theme-hover)]">
                  <div
                    className="w-full rounded bg-accent-500"
                    style={{ height: `${height}px` }}
                    aria-hidden="true"
                  />
                </div>
                <span className="text-[9px] text-[var(--theme-muted)]">
                  {day.slice(5)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}

function usageValue(line: UsageLine): string {
  if (line.value) return line.value
  if (line.used === undefined) return '—'
  if (line.format === 'dollars') return `$${line.used.toFixed(2)}`
  if (line.format === 'percent') return `${Math.round(line.used)}%`
  if (line.format === 'tokens') return line.used.toLocaleString()
  return String(line.used)
}

function providerStatus(status: ProviderUsage['status']): string {
  switch (status) {
    case 'ok':
      return 'Connected'
    case 'missing_credentials':
      return 'Not configured'
    case 'auth_expired':
      return 'Reconnect required'
    case 'error':
      return 'Unavailable'
  }
}

function alertLabel(
  alert: QuotaAlert,
  measure?: UsageLine['measure'],
): string | null {
  const subject = measure === 'spend' ? 'spend limit' : 'quota'
  if (alert === 'limit') return `${subject} reached`
  if (alert === 'critical') return `90%+ of ${subject}`
  if (alert === 'warning') return `75%+ of ${subject}`
  return null
}

function measurementLabel(measure?: UsageLine['measure']): string | null {
  if (measure === 'quota') return 'Quota'
  if (measure === 'usage') return 'Usage'
  if (measure === 'spend') return 'Spend'
  if (measure === 'balance') return 'Balance'
  if (measure === 'availability') return 'Credential check'
  return null
}

function ProviderCard({ provider }: { provider: ProviderUsage }) {
  const hasData = provider.status === 'ok' && provider.lines.length > 0
  const freshness =
    provider.status === 'ok'
      ? providerFreshness(provider.updatedAt)
      : 'unavailable'

  return (
    <article className="min-w-0 rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-[var(--theme-text)]">
            {provider.displayName}
          </h3>
          {provider.plan ? (
            <p className="text-xs text-[var(--theme-muted)]">
              {provider.plan} plan
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
            provider.status === 'ok'
              ? 'bg-emerald-500/10 text-emerald-600'
              : provider.status === 'missing_credentials'
                ? 'bg-[var(--theme-hover)] text-[var(--theme-muted)]'
                : 'bg-amber-500/10 text-amber-600'
          }`}
        >
          {providerStatus(provider.status)}
        </span>
      </div>

      {hasData ? (
        <div className="space-y-3">
          {provider.lines.map((line, index) => {
            const alert = quotaAlert(line)
            const alertText = alertLabel(alert, line.measure)
            const measureText = measurementLabel(line.measure)
            const hasProgress =
              line.type === 'progress' &&
              line.used !== undefined &&
              line.limit !== undefined &&
              line.limit > 0
            const percent = hasProgress
              ? Math.max(0, Math.min(100, (line.used! / line.limit!) * 100))
              : 0

            return (
              <div key={`${line.label}-${index}`} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                  <span className="text-[var(--theme-muted)]">
                    {line.label}
                    {measureText ? (
                      <span className="ml-1 rounded bg-[var(--theme-hover)] px-1 py-0.5 text-[9px] uppercase tracking-wide">
                        {measureText}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2 font-medium tabular-nums text-[var(--theme-text)]">
                    {usageValue(line)}
                    {hasProgress && line.format === 'dollars'
                      ? ` / $${line.limit!.toFixed(2)}`
                      : null}
                    {alertText ? (
                      <span
                        role="status"
                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          alert === 'limit' || alert === 'critical'
                            ? 'bg-red-500/10 text-red-600'
                            : 'bg-amber-500/10 text-amber-600'
                        }`}
                      >
                        {alertText}
                      </span>
                    ) : null}
                  </span>
                </div>
                {hasProgress ? (
                  <div
                    className="h-2 overflow-hidden rounded-full bg-[var(--theme-hover)]"
                    role="progressbar"
                    aria-label={`${provider.displayName} ${line.label}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(percent)}
                  >
                    <div
                      className={`h-full rounded-full transition-[width] ${
                        alert === 'limit' || alert === 'critical'
                          ? 'bg-red-500'
                          : alert === 'warning'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                ) : null}
                {line.resetsAt ? (
                  <p className="text-[10px] text-[var(--theme-muted)]">
                    Resets {new Date(line.resetsAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--theme-muted)]">
          {provider.message ?? 'No usage data reported by this provider.'}
        </p>
      )}
      <p className="mt-3 text-[10px] text-[var(--theme-muted)]">
        Source: {provider.source ?? 'Source metadata unavailable'} · {freshness}{' '}
        {freshness === 'unavailable' ? '· last attempt' : 'snapshot'}{' '}
        {new Date(provider.updatedAt).toLocaleString()} (poll time)
      </p>
    </article>
  )
}

function AgentSummary({
  name,
  detail,
  note,
}: {
  name: string
  detail: string
  note: string
}) {
  return (
    <div className="rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-3">
      <div className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
        {name}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-[var(--theme-text)]">
        {detail}
      </div>
      <div className="mt-1 text-[10px] text-[var(--theme-muted)]">{note}</div>
    </div>
  )
}

function BudgetSummary({
  title,
  budget,
}: {
  title: string
  budget: {
    level:
      'unconfigured' | 'no_data' | 'ok' | 'warning' | 'critical' | 'exhausted'
    limitUsd: number | null
    usedUsd: number | null
    remainingUsd: number | null
    message: string
    periodDays?: number
  }
}) {
  const urgent = budget.level === 'exhausted' || budget.level === 'critical'
  const tone = urgent
    ? 'bg-red-500/15 text-red-300'
    : budget.level === 'warning'
      ? 'bg-amber-500/15 text-amber-300'
      : 'bg-emerald-500/15 text-emerald-300'
  return (
    <div
      className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] p-3"
      aria-label={title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-[var(--theme-text)]">
            {title}
          </h3>
          <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
            {budget.periodDays
              ? `${budget.periodDays}-day rolling window`
              : 'Advisory cross-provider signal'}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-[10px] font-semibold ${tone}`}
        >
          {budget.level === 'unconfigured'
            ? 'Not configured'
            : budget.level.replace('_', ' ')}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--theme-text)]">
        {budget.usedUsd == null || budget.limitUsd == null
          ? budget.message
          : `$${budget.usedUsd.toFixed(2)} observed / $${budget.limitUsd.toFixed(2)} limit · $${budget.remainingUsd?.toFixed(2)} remaining`}
      </p>
      <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
        {budget.message}
      </p>
    </div>
  )
}

export function AiUsagePanel({
  hermesUsage,
  copilotUsage,
  copilotDailyUsage,
  hermesDailyUsage,
}: {
  hermesUsage: HermesModelUsage | null
  copilotUsage: CopilotUsage | null
  copilotDailyUsage: Array<CopilotDailyUsage> | null
  hermesDailyUsage: Array<HermesDailyUsage> | null
}) {
  const [historyRange, setHistoryRange] = useState<7 | 31>(7)
  const query = useQuery({
    queryKey: ['provider-usage', 'ops-cost'],
    queryFn: async () => {
      const response = await fetch('/api/provider-usage', {
        headers: { Accept: 'application/json' },
      })
      const payload = (await response
        .json()
        .catch(() => null)) as ProviderUsageResponse | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      return payload
    },
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const providers = query.data?.providers ?? []
  const codex = providers.find((provider) => provider.provider === 'codex')
  const claude = providers.find((provider) => provider.provider === 'claude')
  const lastUpdated = query.data?.updatedAt
  const sharedBudget = query.data?.sharedBudget
  const monthlyBudget = query.data?.monthlyBudget
  const anomalies = query.data?.anomalies ?? []
  const days = historyRange === 31 ? lastThirtyOneUtcDays() : lastSevenUtcDays()
  const trendSeries: Array<{
    key: string
    title: string
    unit: string
    values: Map<string, number>
    formatValue: (value: number) => string
  }> = []

  if (copilotDailyUsage?.length) {
    trendSeries.push(
      {
        key: 'copilot-requests',
        title: 'Copilot requests',
        unit: 'Requests',
        values: new Map(
          copilotDailyUsage.map((row) => [row.day, row.requests]),
        ),
        formatValue: (value) => Math.round(value).toLocaleString(),
      },
      {
        key: 'copilot-tokens',
        title: 'Copilot tokens',
        unit: 'Tokens',
        values: new Map(
          copilotDailyUsage.map((row) => [
            row.day,
            row.inputTokens + row.outputTokens,
          ]),
        ),
        formatValue: (value) => Math.round(value).toLocaleString(),
      },
      {
        key: 'copilot-aiu',
        title: 'Copilot AI units',
        unit: 'AI units',
        values: new Map(copilotDailyUsage.map((row) => [row.day, row.aiu])),
        formatValue: (value) =>
          value.toLocaleString(undefined, { maximumFractionDigits: 3 }),
      },
    )
  }
  if (hermesDailyUsage?.length) {
    trendSeries.push(
      {
        key: 'hermes-sessions',
        title: 'Hermes gateway sessions',
        unit: 'Sessions',
        values: new Map(hermesDailyUsage.map((row) => [row.day, row.sessions])),
        formatValue: (value) => Math.round(value).toLocaleString(),
      },
      {
        key: 'hermes-tokens',
        title: 'Hermes gateway tokens',
        unit: 'Tokens',
        values: new Map(hermesDailyUsage.map((row) => [row.day, row.tokens])),
        formatValue: (value) => Math.round(value).toLocaleString(),
      },
      {
        key: 'hermes-billed-cost',
        title: 'Hermes billable cost',
        unit: 'USD (actual where available; otherwise estimated)',
        values: new Map(
          hermesDailyUsage.map((row) => [row.day, row.billedCostUsd]),
        ),
        formatValue: (value) => `$${value.toFixed(2)}`,
      },
      {
        key: 'hermes-recorded-cost',
        title: 'Hermes cost including subscriptions',
        unit: 'USD (actual where available; otherwise estimated)',
        values: new Map(
          hermesDailyUsage.map((row) => [row.day, row.estimatedCostUsd]),
        ),
        formatValue: (value) => `$${value.toFixed(2)}`,
      },
    )
  }
  const providerHistory = query.data?.history ?? []
  const providerSeries = new Map<
    string,
    { provider: string; label: string; values: Map<string, number> }
  >()
  for (const point of providerHistory) {
    const value = point.percent ?? point.used
    const key = `${point.provider}:${point.label}:${point.measure}`
    const series = providerSeries.get(key) ?? {
      provider: point.displayName,
      label: point.label,
      values: new Map<string, number>(),
    }
    series.values.set(point.day, value)
    providerSeries.set(key, series)
  }
  for (const [key, series] of providerSeries) {
    const measure = providerHistory.find(
      (point) => `${point.provider}:${point.label}:${point.measure}` === key,
    )?.measure
    trendSeries.push({
      key,
      title: `${series.provider} · ${series.label} snapshot`,
      unit:
        measure === 'quota'
          ? 'Percent used at latest daily snapshot'
          : 'USD at latest daily snapshot',
      values: series.values,
      formatValue: (value) =>
        measure === 'quota' ? `${Math.round(value)}%` : `$${value.toFixed(2)}`,
    })
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--theme-text)]">
            AI agent &amp; provider usage
          </h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Quota, spend, usage, and credential checks are labeled by source;
            Hermes and Copilot local telemetry are shown separately.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated ? (
            <span className="text-[10px] text-[var(--theme-muted)]">
              Snapshot {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="rounded-lg border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-text)] transition hover:bg-[var(--theme-hover)] disabled:opacity-50"
          >
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {query.data?.degraded ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-[var(--theme-text)]"
        >
          Provider readings are temporarily unavailable. Usage limits are not
          treated as zero; retry when the provider service is reachable.
          {query.data.error ? ` ${query.data.error}` : ''}
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="ml-2 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <AgentSummary
          name="Codex"
          detail={
            codex?.status === 'ok'
              ? (codex.plan ?? 'Connected')
              : providerStatus(codex?.status ?? 'missing_credentials')
          }
          note="Session and weekly limits when reported"
        />
        <AgentSummary
          name="Claude"
          detail={
            claude?.status === 'ok'
              ? (claude.plan ?? 'Connected')
              : providerStatus(claude?.status ?? 'missing_credentials')
          }
          note="Session and weekly limits when reported"
        />
        <AgentSummary
          name="Copilot"
          detail={
            copilotUsage
              ? `${copilotUsage.requests7d.toLocaleString()} usage events / 7d`
              : 'No local telemetry'
          }
          note={
            copilotUsage
              ? `${copilotUsage.requests24h.toLocaleString()} today · ${copilotUsage.sessions7d.toLocaleString()} sessions · ${(copilotUsage.inputTokens7d + copilotUsage.outputTokens7d).toLocaleString()} tokens · ${copilotUsage.aiu7d.toLocaleString()} AIU · local CLI telemetry, not GitHub billing; provider limits unavailable${copilotUsage.lastEventAt ? ` · last ${new Date(copilotUsage.lastEventAt).toLocaleString()}` : ''}`
              : 'Copilot CLI usage database unavailable'
          }
        />
        <AgentSummary
          name="Hermes gateway · 7d"
          detail={
            hermesUsage
              ? `${hermesUsage.sessions.toLocaleString()} sessions`
              : 'No telemetry'
          }
          note={
            hermesUsage
              ? `${hermesUsage.tokens.toLocaleString()} tokens · gateway sessions only; provider plan limits unavailable`
              : 'Gateway session store unavailable'
          }
        />
      </div>

      {sharedBudget || monthlyBudget ? (
        <div
          className="grid gap-2 md:grid-cols-2"
          aria-label="Shared AI usage budgets"
        >
          {sharedBudget ? (
            <BudgetSummary title="Shared daily budget" budget={sharedBudget} />
          ) : null}
          {monthlyBudget ? (
            <BudgetSummary
              title="Shared monthly budget"
              budget={monthlyBudget}
            />
          ) : null}
        </div>
      ) : null}

      {trendSeries.length > 0 ? (
        <section aria-label="Daily AI usage trends" className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-[var(--theme-text)]">
                Daily trends · last {historyRange} days
              </h3>
              <p className="text-[10px] text-[var(--theme-muted)]">
                UTC days. Copilot and Hermes are daily totals; provider quota
                and spend cards show the latest reading that day. Missing days
                mean no source data was observed, not zero usage. Provider
                history accumulates after the first authenticated dashboard
                read.
              </p>
            </div>
            <div
              className="flex shrink-0 rounded-lg border border-[var(--theme-border)] p-0.5"
              role="group"
              aria-label="Usage history range"
            >
              {([7, 31] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={historyRange === range}
                  onClick={() => setHistoryRange(range)}
                  className="rounded-md px-2 py-1 text-[10px] text-[var(--theme-text)] transition hover:bg-[var(--theme-hover)] aria-pressed:bg-[var(--theme-hover)]"
                >
                  {range}d
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {trendSeries.map((series) => (
              <DailyTrendCard
                key={series.key}
                title={series.title}
                unit={series.unit}
                days={days}
                values={series.values}
                formatValue={series.formatValue}
              />
            ))}
          </div>
        </section>
      ) : null}

      {anomalies.length > 0 ? (
        <section
          aria-label="Usage anomaly alerts"
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-[var(--theme-text)]">
              Usage anomaly alerts
            </h3>
            <span className="text-[10px] text-[var(--theme-muted)]">
              latest sample vs recent baseline
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {anomalies.map((anomaly) => (
              <div
                key={`${anomaly.provider}:${anomaly.label}:${anomaly.measure}:${anomaly.day}`}
                className={`rounded-md border px-2 py-2 text-xs ${
                  anomaly.severity === 'critical'
                    ? 'border-red-500/40 bg-red-500/5'
                    : 'border-amber-500/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--theme-text)]">
                    {anomaly.displayName} · {anomaly.label}
                  </span>
                  <span className="uppercase text-[10px] text-amber-300">
                    {anomaly.severity}
                  </span>
                </div>
                <p className="mt-1 text-[var(--theme-muted)]">
                  {anomaly.message} Latest {anomaly.used.toFixed(2)} vs baseline{' '}
                  {anomaly.baseline.toFixed(2)} ({anomaly.day}).
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {query.isError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-[var(--theme-text)]">
          Provider readings unavailable: {query.error.message}
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="ml-2 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}

      {providers.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <ProviderCard key={provider.provider} provider={provider} />
          ))}
        </div>
      ) : query.isPending ? (
        <p className="text-xs text-[var(--theme-muted)]">
          Loading connected provider readings…
        </p>
      ) : null}

      <p className="text-[10px] text-[var(--theme-muted)]">
        Copilot readings come from local CLI counters, not GitHub billing
        totals. OpenAI API token usage is not billing data. Provider limits are
        separate and are not a combined budget; undocumented account feeds are
        labeled, and missing feeds are unavailable rather than estimated.
      </p>
    </section>
  )
}
