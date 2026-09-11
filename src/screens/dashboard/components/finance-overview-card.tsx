import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Alert01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

type FinanceSummary = {
  netWorthLkr: number
  netSavingsLkr: number
  savingsRate: number
  tradingMode: string
  emergencyKillSwitch: boolean
}

type FinanceResponse = {
  ok: boolean
  summary?: FinanceSummary
}

function formatLkr(value: number): string {
  return `LKR ${Math.round(value).toLocaleString('en-LK')}`
}

export function FinanceOverviewCard() {
  const summaryId = useId()
  const query = useQuery({
    queryKey: ['dashboard', 'finance-overview'],
    queryFn: async (): Promise<FinanceSummary> => {
      const controller = new AbortController()
      const timeout = globalThis.setTimeout(() => controller.abort(), 5_000)
      try {
        const response = await fetch('/api/finance/summary', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok)
          throw new Error(`Finance API returned HTTP ${response.status}`)
        const data = (await response.json()) as FinanceResponse
        if (!data.ok || !data.summary)
          throw new Error('Finance summary unavailable')
        return data.summary
      } finally {
        globalThis.clearTimeout(timeout)
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    // This is a secondary dashboard summary. A failed first request should
    // resolve to the explicit recovery state immediately instead of leaving
    // the card in a misleading "Syncing" state while the global dashboard
    // already reports that telemetry is unavailable.
    retry: 0,
  })

  const summary = query.data
  const statusTone = query.isError
    ? 'var(--theme-warning)'
    : 'var(--theme-success)'
  const safetyLabel = summary?.emergencyKillSwitch
    ? 'kill switch active'
    : 'safety cutoff off'

  return (
    <Link
      to="/personal-finance"
      aria-label="Open Finance overview"
      aria-describedby={summaryId}
      aria-busy={query.isFetching ? 'true' : undefined}
      className="group relative flex min-h-[148px] w-full flex-col gap-3 overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-left motion-safe:transition-colors hover:bg-[var(--theme-card2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: `linear-gradient(90deg, ${statusTone}, color-mix(in srgb, ${statusTone} 50%, transparent), transparent)`,
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
            Finance overview
          </h2>
          <p className="mt-1 line-clamp-2 text-xs text-[var(--theme-muted)]">
            Personal finance + controlled trading
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs font-medium text-[var(--theme-success)] motion-safe:transition-colors group-hover:text-[var(--theme-text)]">
          {query.isFetching && summary ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--theme-muted)] motion-safe:animate-pulse">
              Updating…
            </span>
          ) : null}
          <span>Open</span>
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.8} />
        </span>
      </div>

      {query.isLoading ? (
        <div
          id={summaryId}
          className="space-y-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)]/45 p-3"
          aria-busy="true"
          aria-label="Loading finance summary"
        >
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--theme-muted)]">
            <span className="size-1.5 rounded-full bg-[var(--theme-success)] motion-safe:animate-pulse" />
            Syncing finance data
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-8 rounded-md bg-[var(--theme-border)]/55 motion-safe:animate-pulse" />
            <div className="h-8 rounded-md bg-[var(--theme-border)]/55 motion-safe:animate-pulse" />
          </div>
        </div>
      ) : query.isError || !summary ? (
        <div
          id={summaryId}
          role="status"
          className="flex items-start gap-2 rounded-lg border p-3 text-xs text-[var(--theme-text)]"
          style={{
            borderColor:
              'color-mix(in srgb, var(--theme-warning) 30%, transparent)',
            background:
              'color-mix(in srgb, var(--theme-warning) 10%, transparent)',
          }}
        >
          <span
            aria-hidden
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md"
            style={{
              background:
                'color-mix(in srgb, var(--theme-warning) 14%, transparent)',
              color: 'var(--theme-warning)',
            }}
          >
            <HugeiconsIcon icon={Alert01Icon} size={12} strokeWidth={1.8} />
          </span>
          <span>
            <span className="mb-0.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-warning)]">
              Unavailable
            </span>
            Finance summary is temporarily unavailable. Open Finance to retry.
          </span>
        </div>
      ) : (
        <div id={summaryId}>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-[var(--theme-card2)]/65 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">
                Net worth
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--theme-text)]">
                {formatLkr(summary.netWorthLkr)}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--theme-card2)]/65 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">
                Savings rate
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--theme-text)]">
                {summary.savingsRate.toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--theme-muted)]">
              Mode:{' '}
              <strong className="text-[var(--theme-text)]">
                {summary.tradingMode.replace(/_/g, ' ')}
              </strong>
            </span>
            <span
              className={
                summary.emergencyKillSwitch
                  ? 'text-[var(--theme-danger)]'
                  : 'text-[var(--theme-warning)]'
              }
            >
              {safetyLabel}
            </span>
          </div>
        </div>
      )}
    </Link>
  )
}
