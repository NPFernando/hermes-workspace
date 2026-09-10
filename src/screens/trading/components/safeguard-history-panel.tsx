/** Safeguard-application history panel. Extracted verbatim from trading-screen.tsx. */
import { csvDateSuffix, downloadCsv } from '../csv'
import { formatDateTime, formatUsdt } from '../format-helpers'
import type { SafeguardHistoryEntry } from '../trading-types'

export function SafeguardHistoryPanel({
  rows,
}: {
  rows: Array<SafeguardHistoryEntry>
}) {
  function exportRows() {
    downloadCsv(
      `finance-safeguard-history-${csvDateSuffix()}.csv`,
      rows.map((row) => ({
        id: row.id,
        appliedAt: row.appliedAt,
        status: row.status,
        recommendedMode: row.recommendedMode,
        appliedTradingMode: row.appliedTradingMode,
        executionAccount: row.executionAccount,
        liveTradingEnabled: row.liveTradingEnabled,
        baseQuotePerTrade: row.baseQuotePerTrade,
        previousQuotePerTrade: row.previousQuotePerTrade,
        appliedQuotePerTrade: row.appliedQuotePerTrade,
        positionSizeMultiplier: row.positionSizeMultiplier,
        pauseLive: row.pauseLive,
        liveRecommendationDeferred: row.liveRecommendationDeferred,
        reasonSummary: row.reasonSummary,
      })),
    )
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Safeguard history</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Applied decision-quality adjustments and the mode/size they
            enforced.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
            {rows.length} records
          </span>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={exportRows}
            className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
          No safeguards have been applied yet.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              <tr>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Applied
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Status
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Mode
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Account
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Size
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Multiplier
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Live
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="align-top text-[var(--theme-text)]">
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {formatDateTime(row.appliedAt)}
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4 capitalize">
                    {row.status.replace(/_/g, ' ')}
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {row.appliedTradingMode}
                    {row.liveRecommendationDeferred ? (
                      <span className="ml-2 rounded-full border border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] px-2 py-0.5 text-[10px] text-[var(--theme-warning)]">
                        live deferred
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {row.executionAccount}
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {formatUsdt(row.appliedQuotePerTrade)}
                    <span className="block text-xs text-[var(--theme-muted)]">
                      base {formatUsdt(row.baseQuotePerTrade)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {row.positionSizeMultiplier.toFixed(2)}x
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {row.liveTradingEnabled
                      ? 'enabled'
                      : row.pauseLive
                        ? 'paused'
                        : 'off'}
                  </td>
                  <td className="max-w-[360px] border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                    {row.reasonSummary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Consecutive recovery-eligible daily runs a throttled strategy needs before
 * each auto-restore step. Mirrors STRATEGY_RESTORE_HEALTHY_RUNS in
 * demo-trading-engine.ts. */
