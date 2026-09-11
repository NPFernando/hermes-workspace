import { useId, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  CancelIcon,
  ChartLineData01Icon,
} from '@hugeicons/core-free-icons'
import { Link } from '@tanstack/react-router'
import { DashboardDialog } from './dashboard-dialog'
import { DashboardUnavailableState } from './dashboard-empty-state'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { formatModelName } from '@/screens/dashboard/lib/formatters'
import {
  safeAnalyticsDaily,
  safeAnalyticsModels,
  selectAnalyticsDailyPeriod,
} from '@/screens/dashboard/lib/analytics-normalizers'

export type AnalyticsPeriod = 7 | 14 | 30

const PERIODS: Array<AnalyticsPeriod> = [7, 14, 30]

function formatTokens(n: number): string {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCost(usd: number): string {
  if (!usd || usd <= 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1) return `$${usd.toFixed(3)}`
  if (usd < 100) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function shortDay(day: string): string {
  const ts = Date.parse(day)
  if (!Number.isFinite(ts)) return day
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

type ChartDatum = {
  day: string
  label: string
  tokens: number
  input: number
  output: number
  cache: number
  reasoning: number
  sessions: number
  apiCalls: number
  cost: number
}

/**
 * Analytics trend chart card — the daily token mix area plot, plus a
 * row of insight callouts the operator can scan in 2 seconds before
 * looking at the curve. The period selector at top-right swaps the
 * window between 7 / 14 / 30 days, persisted up to the parent so
 * Hero KPIs use the same window.
 */
export function AnalyticsChartCard({
  analytics,
  insights,
  period,
  onPeriodChange,
  loading,
  unavailable = false,
}: {
  analytics: DashboardOverview['analytics']
  insights: DashboardOverview['insights']
  period: AnalyticsPeriod
  onPeriodChange: (next: AnalyticsPeriod) => void
  loading?: boolean
  unavailable?: boolean
}) {
  const [showModal, setShowModal] = useState(false)
  const expandButtonRef = useRef<HTMLButtonElement>(null)

  const data: Array<ChartDatum> = useMemo(() => {
    if (!analytics) return []
    return selectAnalyticsDailyPeriod(
      safeAnalyticsDaily(analytics),
      period,
    ).map((d) => ({
      day: typeof d.day === 'string' ? d.day : '',
      label: shortDay(typeof d.day === 'string' ? d.day : ''),
      tokens: safeNumber(d.inputTokens) + safeNumber(d.outputTokens),
      input: safeNumber(d.inputTokens),
      output: safeNumber(d.outputTokens),
      cache: safeNumber(d.cacheReadTokens),
      reasoning: safeNumber(d.reasoningTokens),
      sessions: safeNumber(d.sessions),
      apiCalls: safeNumber(d.apiCalls),
      cost: safeNumber(d.estimatedCost),
    }))
  }, [analytics, period])

  if (unavailable) return <DashboardUnavailableState title="Usage analytics" />

  if (!analytics) return null
  const hasData = analytics.source === 'analytics' && data.length > 0
  const hasTrend = hasData && data.length > 1

  return (
    <>
      <div
        className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-[var(--theme-border)] p-4"
        style={{
          background:
            'linear-gradient(150deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 90%, transparent))',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full opacity-20 blur-3xl bg-[var(--theme-accent)]"
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon
              icon={ChartLineData01Icon}
              size={16}
              strokeWidth={1.5}
              className="text-[var(--theme-accent)]"
            />
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
                Usage trend · {period}d
              </h2>
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--theme-muted)]">
                {formatTokens(analytics.totalTokens)} tokens ·{' '}
                {safeNumber(analytics.totalApiCalls).toLocaleString()} calls ·{' '}
                {formatCost(analytics.estimatedCostUsd ?? 0)}
                {loading ? ' · refreshing…' : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <PeriodSwitch
              value={period}
              onChange={onPeriodChange}
              disabled={loading}
            />
            {hasData ? (
              <button
                type="button"
                ref={expandButtonRef}
                onClick={() => setShowModal(true)}
                className="ml-1 inline-flex min-h-11 items-center gap-1 rounded border border-[var(--theme-border)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
              >
                <span>Expand</span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={12}
                  strokeWidth={1.8}
                />
              </button>
            ) : null}
          </div>
        </div>

        {insights.length > 0 ? (
          <ul
            className="flex flex-col gap-1 rounded-md border border-[var(--theme-border)] p-2 text-[11px]"
            style={{
              background:
                'color-mix(in srgb, var(--theme-card) 92%, transparent)',
            }}
          >
            {insights.map((line, i) => {
              const tone =
                line.tone === 'positive'
                  ? 'var(--theme-success)'
                  : line.tone === 'warn'
                    ? 'var(--theme-warning)'
                    : 'var(--theme-accent)'
              return (
                <li
                  key={i}
                  className="flex items-center gap-2 text-[var(--theme-text)]"
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: tone }}
                  />
                  <span
                    className="min-w-0 line-clamp-2 leading-relaxed"
                    title={line.text}
                  >
                    {line.text}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : null}

        {hasTrend ? (
          <div
            role="img"
            aria-label={`Usage trend for the last ${period} days: ${formatTokens(safeNumber(analytics.totalTokens))} tokens across ${safeNumber(analytics.totalApiCalls).toLocaleString()} API calls.`}
            className="h-[200px] w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="atok" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--theme-accent)"
                      stopOpacity={0.45}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--theme-accent)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient id="acache" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--theme-accent-secondary)"
                      stopOpacity={0.25}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--theme-accent-secondary)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="var(--theme-border)"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={(v: number) => formatTokens(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--theme-card)',
                    border: '1px solid var(--theme-border)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  labelStyle={{
                    color: 'var(--theme-muted)',
                    fontSize: 10,
                  }}
                  formatter={(value: number, name: string) => [
                    formatTokens(value),
                    name,
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="cache"
                  name="cache"
                  stroke="var(--theme-accent-secondary)"
                  fill="url(#acache)"
                  strokeWidth={1}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="tokens"
                  name="tokens"
                  stroke="var(--theme-accent)"
                  fill="url(#atok)"
                  strokeWidth={1.6}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : hasData ? (
          <SparseAnalyticsState datum={data[0]} period={period} />
        ) : (
          <div
            role="group"
            aria-label={`Usage analytics: no analytics usage in the last ${period} days.`}
            className="flex h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-dashed text-[11px]"
            style={{
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-muted)',
            }}
          >
            No analytics usage in the last {period}d.
            <Link
              to="/chat/$sessionKey"
              params={{ sessionKey: 'new' }}
              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-[var(--theme-accent)]/40 bg-[var(--theme-accent)]/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-accent)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
            >
              <span>Start a chat</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={12}
                strokeWidth={1.8}
              />
            </Link>
          </div>
        )}

        {hasTrend ? (
          <div className="flex items-center gap-4 text-[10px]">
            <Legend tone="var(--theme-accent)" label="tokens (in+out)" />
            <Legend tone="var(--theme-accent-secondary)" label="cache reads" />
          </div>
        ) : null}
      </div>

      {showModal && hasData ? (
        <AnalyticsModal
          analytics={analytics}
          data={data}
          period={period}
          onClose={() => {
            setShowModal(false)
            requestAnimationFrame(() => expandButtonRef.current?.focus())
          }}
        />
      ) : null}
    </>
  )
}

function SparseAnalyticsState({
  datum,
  period,
}: {
  datum: ChartDatum
  period: AnalyticsPeriod
}) {
  return (
    <div
      role="group"
      aria-label={`Usage analytics: first telemetry point recorded on ${datum.label}. Usage trends will take shape as more days are recorded in this ${period}-day window.`}
      className="flex min-h-[120px] flex-col justify-center gap-3 rounded-md border border-dashed px-4 py-3 text-[11px]"
      style={{
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-muted)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-[0.12em] text-[var(--theme-text)]">
          First telemetry point recorded
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em]">
          {datum.label}
        </span>
      </div>
      <p className="leading-relaxed">
        Usage trends will take shape as more days are recorded in this {period}
        -day window.
      </p>
      <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
        <span>
          <span className="block uppercase tracking-[0.1em]">Tokens</span>
          <strong className="text-[var(--theme-text)]">
            {formatTokens(datum.tokens)}
          </strong>
        </span>
        <span>
          <span className="block uppercase tracking-[0.1em]">Calls</span>
          <strong className="text-[var(--theme-text)]">
            {datum.apiCalls.toLocaleString()}
          </strong>
        </span>
        <span>
          <span className="block uppercase tracking-[0.1em]">Cost</span>
          <strong className="text-[var(--theme-text)]">
            {formatCost(datum.cost)}
          </strong>
        </span>
      </div>
    </div>
  )
}

function PeriodSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: AnalyticsPeriod
  onChange: (next: AnalyticsPeriod) => void
  disabled?: boolean
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  return (
    <div
      className="inline-flex items-center overflow-hidden rounded border border-[var(--theme-border)]"
      role="tablist"
      aria-label="Analytics period"
    >
      {PERIODS.map((p) => {
        const active = p === value
        return (
          <button
            key={p}
            ref={(element) => {
              tabRefs.current[PERIODS.indexOf(p)] = element
            }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled}
            aria-label={`Show ${p}-day usage trend`}
            title={`Show ${p}-day usage trend`}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(p)}
            onKeyDown={(event) => {
              if (disabled) return
              const index = PERIODS.indexOf(p)
              let nextIndex: number | null = null
              if (event.key === 'ArrowRight') {
                nextIndex = (index + 1) % PERIODS.length
              } else if (event.key === 'ArrowLeft') {
                nextIndex = (index - 1 + PERIODS.length) % PERIODS.length
              } else if (event.key === 'Home') {
                nextIndex = 0
              } else if (event.key === 'End') {
                nextIndex = PERIODS.length - 1
              }
              if (nextIndex === null) return
              event.preventDefault()
              const next = PERIODS[nextIndex]
              onChange(next)
              requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus())
            }}
            className="min-h-11 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] motion-safe:transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset disabled:cursor-wait disabled:opacity-60 lg:min-h-0 md:px-2"
            style={{
              background: active
                ? 'color-mix(in srgb, var(--theme-accent) 18%, transparent)'
                : 'transparent',
              color: active ? 'var(--theme-accent)' : 'var(--theme-muted)',
              borderRight:
                p !== PERIODS[PERIODS.length - 1]
                  ? '1px solid var(--theme-border)'
                  : 'none',
            }}
          >
            {p}d
          </button>
        )
      })}
    </div>
  )
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[var(--theme-muted)]">
      <span
        className="size-2 rounded-full"
        style={{ background: tone }}
        aria-hidden
      />
      {label}
    </span>
  )
}

function AnalyticsModal({
  analytics,
  data,
  period,
  onClose,
}: {
  analytics: NonNullable<DashboardOverview['analytics']>
  data: Array<ChartDatum>
  period: AnalyticsPeriod
  onClose: () => void
}) {
  const titleId = useId()

  return (
    <DashboardDialog
      titleId={titleId}
      onClose={onClose}
      className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-[var(--theme-card)] border-[var(--theme-border)]"
    >
      <div className="flex items-center justify-between border-b px-5 py-3 border-[var(--theme-border)]">
        <div>
          <h2
            id={titleId}
            className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]"
          >
            Usage trend · last {period}d
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--theme-muted)]">
            {formatTokens(analytics.totalTokens)} tokens ·{' '}
            {safeNumber(analytics.totalSessions).toLocaleString()} sessions ·{' '}
            {safeNumber(analytics.totalApiCalls).toLocaleString()} calls ·{' '}
            {formatCost(analytics.estimatedCostUsd ?? 0)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0 lg:min-w-0"
        >
          <HugeiconsIcon
            icon={CancelIcon}
            size={18}
            strokeWidth={1.5}
            className="text-[var(--theme-muted)]"
          />
        </button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            Daily token mix
          </h3>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="var(--theme-border)"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v: number) => formatTokens(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--theme-card)',
                    border: '1px solid var(--theme-border)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(value: number, name: string) => [
                    formatTokens(value),
                    name,
                  ]}
                />
                <Bar
                  dataKey="input"
                  name="input"
                  stackId="t"
                  fill="var(--theme-accent)"
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  dataKey="output"
                  name="output"
                  stackId="t"
                  fill="var(--theme-success)"
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  dataKey="reasoning"
                  name="reasoning"
                  stackId="t"
                  fill="var(--theme-warning)"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px]">
            <Legend tone="var(--theme-accent)" label="input" />
            <Legend tone="var(--theme-success)" label="output" />
            <Legend tone="var(--theme-warning)" label="reasoning" />
          </div>
        </div>

        <div className="lg:col-span-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            Models · ranked by tokens
          </h3>
          <div className="space-y-2">
            {safeAnalyticsModels(analytics).map((m, i) => (
              <div
                key={m.id}
                className="rounded border px-3 py-2 border-[var(--theme-border)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] font-semibold text-[var(--theme-text)]">
                    <span className="mr-1.5 inline-block w-4 text-right tabular-nums text-[var(--theme-muted)]">
                      {i + 1}
                    </span>
                    {formatModelName(m.id)}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--theme-muted)]">
                    {formatTokens(m.tokens)}
                  </span>
                </div>
                <div
                  className="mt-1 truncate font-mono text-[10px] text-[var(--theme-muted)]"
                  title={m.id}
                >
                  {m.id}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10px]">
                  <span className="text-[var(--theme-muted)]">
                    sessions{' '}
                    <span className="text-[var(--theme-text)]">
                      {safeNumber(m.sessions).toLocaleString()}
                    </span>
                  </span>
                  <span className="text-[var(--theme-muted)]">
                    calls{' '}
                    <span className="text-[var(--theme-text)]">
                      {safeNumber(m.calls).toLocaleString()}
                    </span>
                  </span>
                  <span className="text-[var(--theme-muted)]">
                    cost{' '}
                    <span className="text-[var(--theme-text)]">
                      {formatCost(m.cost)}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardDialog>
  )
}
