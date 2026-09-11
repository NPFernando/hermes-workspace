import { ArrowRight01Icon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { formatModelName } from '@/screens/dashboard/lib/formatters'
import { useDashboardRefresh } from '@/screens/dashboard/lib/dashboard-refresh-context'
import {
  safeAnalyticsModels,
  safeNumber,
} from '@/screens/dashboard/lib/analytics-normalizers'

function formatCount(n: number): string {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

/**
 * Hero-row tile showing the *active* model. Replaces the Cost tile
 * the operator was finding misleading (the gateway runs codex / OAuth
 * which structurally read \$0). This tile answers a more decision-
 * relevant question: "what is Hermes routing through right now and
 * how much of the load is it carrying?"
 *
 * Wireframe-equivalent to the other Hero tiles (matching gradient
 * accent + connection pulse) so the row stays balanced.
 */
export function ActiveModelKpi({
  modelInfo,
  analytics,
  loading = false,
  unavailable = false,
}: {
  modelInfo: DashboardOverview['modelInfo']
  analytics: DashboardOverview['analytics']
  loading?: boolean
  unavailable?: boolean
}) {
  const refreshState = useDashboardRefresh()
  const connected = !!modelInfo && !loading && !unavailable
  const display = loading
    ? 'Syncing…'
    : modelInfo
      ? formatModelName(modelInfo.model)
      : unavailable
        ? 'Unavailable'
        : 'Not connected'
  const provider = loading
    ? 'Loading routing data'
    : (modelInfo?.provider ?? 'Connect a gateway to see routing')

  // Routing share (proxy): % of calls in the analytics window that hit
  // the active model. Hermes Agent confirmed this is the closest
  // available metric without a dedicated routing-decisions endpoint.
  const share = ((): number | null => {
    if (!modelInfo || !analytics) return null
    const totalApiCalls = safeNumber(analytics.totalApiCalls)
    if (totalApiCalls <= 0) return null
    const match = safeAnalyticsModels(analytics).find(
      (m) => m.id === modelInfo.model,
    )
    if (!match) return null
    return Math.round((safeNumber(match.calls) / totalApiCalls) * 100)
  })()

  const sessionsForModel = ((): number | null => {
    if (!modelInfo || !analytics) return null
    const match = safeAnalyticsModels(analytics).find(
      (m) => m.id === modelInfo.model,
    )
    return match ? safeNumber(match.sessions) : null
  })()

  const tone = loading
    ? 'var(--theme-accent)'
    : connected
      ? 'var(--theme-success)'
      : unavailable
        ? 'var(--theme-warning)'
        : 'var(--theme-danger)'
  const statusLabel = loading
    ? 'Syncing'
    : unavailable
      ? 'Unavailable'
      : connected
        ? 'Online'
        : 'Offline'

  return (
    <div
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border px-4 pb-3 pt-4"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: `linear-gradient(90deg, ${tone}, ${tone}55, transparent)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-25 blur-2xl"
        style={{ background: tone }}
      />

      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:flex-nowrap sm:gap-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
          Active Model
        </span>
        <span
          className="ml-auto inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold sm:ml-0"
          style={{
            background: connected
              ? 'color-mix(in srgb, var(--theme-success) 14%, transparent)'
              : `color-mix(in srgb, ${tone} 14%, transparent)`,
            color: tone,
          }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: tone }}
          />
          {statusLabel}
        </span>
      </div>

      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-2">
        <span
          className={`${connected ? 'text-xl sm:text-2xl' : 'text-base sm:text-xl'} min-w-0 max-w-full truncate whitespace-nowrap font-mono font-bold leading-none tracking-tight text-[var(--theme-text)]`}
          title={modelInfo?.model}
        >
          {display}
        </span>
        {share !== null ? (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]"
            style={{
              background:
                'color-mix(in srgb, var(--theme-accent) 12%, transparent)',
              color: 'var(--theme-accent)',
            }}
            title="Share of API calls in the analytics window."
          >
            {share}% calls
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col items-start gap-1 text-[10px] sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        {loading ? (
          <span className="min-w-0 flex-1 truncate font-mono uppercase tracking-[0.12em] text-[var(--theme-muted)]">
            Waiting for telemetry
          </span>
        ) : unavailable && refreshState && !refreshState.globalUnavailable ? (
          <button
            type="button"
            onClick={refreshState.refresh}
            disabled={refreshState.isRefreshing}
            aria-busy={refreshState.isRefreshing ? 'true' : undefined}
            aria-label={
              refreshState.isRefreshing
                ? 'Retrying active model telemetry'
                : 'Retry active model telemetry'
            }
            className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] disabled:cursor-wait disabled:opacity-60 lg:min-h-0"
            style={{ borderColor: 'var(--theme-accent-border)' }}
          >
            <HugeiconsIcon
              icon={Refresh01Icon}
              size={12}
              strokeWidth={1.8}
              className={
                refreshState.isRefreshing
                  ? 'motion-safe:animate-spin'
                  : undefined
              }
            />
            {refreshState.isRefreshing ? 'Retrying…' : 'Retry sync'}
          </button>
        ) : unavailable ? (
          <span className="min-w-0 max-w-full whitespace-normal break-words font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--theme-muted)]">
            {refreshState?.globalUnavailable
              ? 'Use Retry sync above'
              : 'Telemetry unavailable'}
          </span>
        ) : connected ? (
          <span className="min-w-0 max-w-full whitespace-normal break-words font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--theme-muted)]">
            {provider}
            {sessionsForModel !== null
              ? ` · ${formatCount(sessionsForModel)} sessions`
              : ''}
          </span>
        ) : (
          <Link
            to="/conductor"
            className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
            style={{ borderColor: 'var(--theme-accent-border)' }}
          >
            <span>Connect gateway</span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={1.8}
            />
          </Link>
        )}
        {modelInfo?.effectiveContextLength ? (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--theme-muted)]">
            ctx {formatCount(modelInfo.effectiveContextLength)}
          </span>
        ) : null}
      </div>
    </div>
  )
}
