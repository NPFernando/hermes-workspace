/** StrategyEligibilityAuditPanel — extracted verbatim from trading-screen.tsx. */
import type { StrategyEligibilityAudit } from '../trading-types'

export function StrategyEligibilityAuditPanel({
  audit,
}: {
  audit: StrategyEligibilityAudit
}) {
  const hasSnapshot = audit.symbols.length > 0 && audit.asOfMs > 0
  return (
    <details className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Strategy eligibility audit</h2>
            <p className="mt-1 text-sm text-[var(--theme-muted)]">
              Read-only replay of every registered strategy against the latest{' '}
              {audit.interval} market window. It does not enable strategies or
              authorize orders.
            </p>
          </div>
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
            {hasSnapshot ? `${audit.symbols.length} symbol(s)` : 'warming up'}
          </span>
        </div>
      </summary>
      {!hasSnapshot ? (
        <p className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] px-3 py-2 text-sm text-[var(--theme-warning)]">
          Market snapshot is warming up. Refresh this section after the
          background market cache completes.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-[var(--theme-muted)]">
            Council threshold: {audit.councilThreshold.toFixed(2)} · execution:{' '}
            {audit.executionMode} · market data as of{' '}
            {new Date(audit.asOfMs).toLocaleTimeString()}
          </p>
          {audit.symbols.map((item) => (
            <section
              key={item.symbol}
              className="rounded-2xl border border-[var(--theme-border)]/70 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{item.symbol}</h3>
                  <p className="text-xs text-[var(--theme-muted)]">
                    {item.candles} candles · price{' '}
                    {item.latestPrice == null
                      ? 'unavailable'
                      : item.latestPrice.toFixed(4)}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs font-semibold">
                  Council {item.council.signal} · net {item.council.net.toFixed(3)}
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {item.strategies.map((strategy) => (
                  <div
                    key={strategy.strategyId}
                    className="rounded-xl border border-[var(--theme-border)]/60 p-3 text-xs"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">
                        {strategy.name}
                        {!strategy.active ? ' · disabled' : ''}
                        {strategy.overrideMode === 'disabled'
                          ? ' · override'
                          : ''}
                      </span>
                      <span
                        className={
                          strategy.signal === 'BUY'
                            ? 'text-[var(--theme-success)]'
                            : strategy.signal === 'SELL'
                              ? 'text-[var(--theme-danger)]'
                              : 'text-[var(--theme-muted)]'
                        }
                      >
                        {strategy.signal} {Math.round(strategy.confidence * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-[var(--theme-muted)]">
                      {strategy.reason}
                    </p>
                    <p className="mt-1 text-[var(--theme-muted)]">
                      {strategy.dataAvailable
                        ? `${item.candles} candles · minimum ${strategy.minCandles}`
                        : strategy.dataIssues.join('; ')}
                    </p>
                    <p className="mt-1 text-[var(--theme-muted)]">
                      {strategy.regime
                        ? `${strategy.muted ? 'Muted' : 'Regime'}: ${strategy.regime}`
                        : 'Regime switching off'}
                      {' · '}
                      {strategy.councilEligible
                        ? 'eligible for council'
                        : strategy.exclusionReason ?? 'not eligible'}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-[var(--theme-muted)]">
                Participating:{' '}
                {item.council.participatingStrategyIds.join(', ') || 'none'} ·{' '}
                {item.council.eligible
                  ? `eligible with lead ${item.council.leadStrategyId ?? 'n/a'}`
                  : `below ${item.council.threshold.toFixed(2)} threshold`}
              </p>
            </section>
          ))}
        </div>
      )}
    </details>
  )
}
