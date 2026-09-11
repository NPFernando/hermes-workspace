import { HugeiconsIcon } from '@hugeicons/react'
import { ChartBarLineIcon } from '@hugeicons/core-free-icons'
import {
  DashboardEmptyState,
  DashboardLoadingState,
  DashboardUnavailableState,
} from './dashboard-empty-state'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { formatModelName } from '@/screens/dashboard/lib/formatters'
import { safeAnalyticsModels } from '@/screens/dashboard/lib/analytics-normalizers'

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

/**
 * Standalone top-models card. Previously this was the right column
 * inside the analytics hero card and felt cramped. Hoisting it out
 * gives each model row enough room to show its share of API calls
 * (proxy for routing share) plus tokens, and lets the chart breathe.
 */
export function TopModelsCard({
  analytics,
  loading = false,
  unavailable = false,
}: {
  analytics: DashboardOverview['analytics']
  loading?: boolean
  unavailable?: boolean
}) {
  if (loading) return <DashboardLoadingState title="Top models" />
  if (unavailable) return <DashboardUnavailableState title="Top models" />
  if (!analytics || analytics.source === 'unavailable') {
    return <DashboardUnavailableState title="Top models" />
  }
  const topModels = safeAnalyticsModels(analytics)
  if (topModels.length === 0) {
    return (
      <DashboardEmptyState
        title="Top models"
        description="Model rankings will appear after the first completed request in this window."
      />
    )
  }
  const totalCalls = safeNumber(analytics.totalApiCalls)
  const maxTokens = safeNumber(topModels[0]?.tokens) || 1

  return (
    <div
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3"
      style={{
        background:
          'linear-gradient(150deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={ChartBarLineIcon}
            size={14}
            strokeWidth={1.5}
            className="text-[var(--theme-accent-secondary,var(--theme-accent))]"
          />
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
            Top models · {analytics.windowDays}d
          </h2>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--theme-muted)]">
          {topModels.length} ranked
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {topModels.map((m, i) => {
          const modelId = typeof m.id === 'string' ? m.id : 'Unknown model'
          const tokens = safeNumber(m.tokens)
          const calls = safeNumber(m.calls)
          const sessions = safeNumber(m.sessions)
          const widthPct = Math.max(2, Math.round((tokens / maxTokens) * 100))
          const sharePct =
            totalCalls > 0 ? Math.round((calls / totalCalls) * 100) : 0
          const tone =
            i === 0
              ? 'var(--theme-accent)'
              : i === 1
                ? 'var(--theme-accent-secondary)'
                : 'var(--theme-muted)'
          return (
            <li key={m.id}>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span
                  className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[var(--theme-text)]"
                  title={modelId}
                >
                  <span className="inline-block w-3 text-right tabular-nums text-[var(--theme-muted)]">
                    {i + 1}
                  </span>
                  {formatModelName(modelId)}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-[var(--theme-muted)]">
                  {formatTokens(tokens)}
                </span>
              </div>
              <div
                className="mt-0.5 h-1 w-full overflow-hidden rounded-full"
                style={{
                  background:
                    'color-mix(in srgb, var(--theme-border) 50%, transparent)',
                }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${widthPct}%`,
                    background: tone,
                  }}
                />
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--theme-muted)]">
                <span>
                  {sharePct}% of calls · {sessions.toLocaleString()} sessions
                </span>
                <span>{formatCost(m.cost)}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
