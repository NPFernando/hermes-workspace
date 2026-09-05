import { useQuery } from '@tanstack/react-query'

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

export function FinanceOverviewCard({ onOpen }: { onOpen: () => void }) {
  const query = useQuery({
    queryKey: ['dashboard', 'finance-overview'],
    queryFn: async (): Promise<FinanceSummary> => {
      const response = await fetch('/api/finance/summary', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Finance API returned HTTP ${response.status}`)
      const data = (await response.json()) as FinanceResponse
      if (!data.ok || !data.summary) throw new Error('Finance summary unavailable')
      return data.summary
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  })

  const summary = query.data
  const safetyLabel = summary?.emergencyKillSwitch ? 'kill switch active' : 'safety cutoff off'

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex w-full flex-col gap-3 overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-left transition-colors hover:bg-[var(--theme-card2)]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-emerald-400 via-emerald-400/50 to-transparent" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
            Finance overview
          </h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Personal finance + controlled trading
          </p>
        </div>
        <span className="text-xs font-medium text-emerald-300 group-hover:text-emerald-200">
          Open →
        </span>
      </div>

      {query.isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-[var(--theme-card2)]" />
      ) : query.isError || !summary ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100">
          Finance summary is temporarily unavailable.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-black/10 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">Net worth</div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--theme-text)]">{formatLkr(summary.netWorthLkr)}</div>
            </div>
            <div className="rounded-lg bg-black/10 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">Savings rate</div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--theme-text)]">{summary.savingsRate.toFixed(1)}%</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--theme-muted)]">Mode: <strong className="text-[var(--theme-text)]">{summary.tradingMode.replace(/_/g, ' ')}</strong></span>
            <span className={summary.emergencyKillSwitch ? 'text-emerald-300' : 'text-red-300'}>{safetyLabel}</span>
          </div>
        </>
      )}
    </button>
  )
}
