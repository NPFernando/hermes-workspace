import { StatCard } from '../../finance/components/stat-card'
import { formatUsdt } from '../format-helpers'
import { useTradingSummary } from '../hooks/use-trading-summary'
import type { TradingEngineArmState } from '../hooks/use-trading-summary'

function pnlTone(value: number): 'good' | 'warn' | 'neutral' {
  if (value > 0) return 'good'
  if (value < 0) return 'warn'
  return 'neutral'
}

const CHIP_STYLE: Record<TradingEngineArmState, string> = {
  live: 'border-[color-mix(in_srgb,var(--theme-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] text-[var(--theme-danger)]',
  sandbox:
    'border-[color-mix(in_srgb,var(--theme-accent-secondary)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent-secondary)_15%,transparent)] text-[var(--theme-accent-secondary)]',
  paper: 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]',
  gated: 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]',
  disabled:
    'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_4%,transparent)] text-[var(--theme-muted)]/60',
}

export function TradingSummaryStrip() {
  const { summary, error } = useTradingSummary()

  if (error) {
    return (
      <section className="mt-6 rounded-3xl border border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] p-4 text-sm text-[var(--theme-danger)]">
        Trading summary unavailable: {error}
      </section>
    )
  }
  if (!summary) {
    return (
      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-4 text-sm text-[var(--theme-muted)]">
        Loading trading summary…
      </section>
    )
  }

  return (
    <section className="mt-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Today's P&L"
          value={formatUsdt(summary.todayPnlQuote)}
          tone={pnlTone(summary.todayPnlQuote)}
        />
        <StatCard
          label="Paper P&L"
          value={formatUsdt(summary.paperPnlQuote)}
          tone={pnlTone(summary.paperPnlQuote)}
        />
        <StatCard
          label="Sandbox P&L"
          value={formatUsdt(summary.sandboxPnlQuote)}
          tone={pnlTone(summary.sandboxPnlQuote)}
        />
        <StatCard
          label="All-stage P&L"
          value={formatUsdt(summary.totalPnlQuote)}
          tone={pnlTone(summary.totalPnlQuote)}
        />
        <StatCard
          label="Live P&L"
          value={formatUsdt(summary.livePnlQuote)}
          tone={pnlTone(summary.livePnlQuote)}
        />
        <StatCard
          label="Open positions"
          value={String(summary.openPositions)}
        />
        <StatCard
          label="Win rate"
          value={
            summary.winRate === null
              ? '—'
              : `${(summary.winRate * 100).toFixed(1)}%`
          }
        />
      </div>
      <p className="mt-2 text-xs text-[var(--theme-muted)]">
        Paper: {summary.paperTrades} trades · Sandbox: {summary.sandboxTrades}{' '}
        trades · Live: {summary.liveTrades} trades. All-stage P&L is historical
        fee-net ledger evidence; it is not a promise of future profit.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {summary.engines.map((engine) => (
          <span
            key={engine.id}
            title={engine.reason}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${CHIP_STYLE[engine.armState]}`}
          >
            {engine.label}: {engine.armState}
          </span>
        ))}
      </div>
    </section>
  )
}
