import { dangerTone, positiveTone, warningTone } from '../shared-styles'
import { formatLkr } from '../utils'
import type { PersonalFinancePayload } from '../types'

function gainTone(value: number): string {
  if (value > 0) return positiveTone
  if (value < 0) return dangerTone
  return 'text-[var(--theme-muted)]'
}

function signed(value: number): string {
  return value >= 0 ? `+${formatLkr(value)}` : formatLkr(value)
}

/**
 * Splits each non-LKR stock holding's total return into the part driven by
 * the asset's own price move vs. pure currency movement since buyDate —
 * `unrealizedStockPnlBase` (the Overview figure) always converts both cost
 * and current value at *today's* rate, so it can't show this on its own.
 * Only rendered when there's at least one non-LKR holding — an all-LKR
 * portfolio has nothing to decompose.
 */
export function FxGainLossCard({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  const { fxGainLoss } = payload
  const nonLkrEntries = fxGainLoss.entries.filter(
    (e) => e.currency !== 'LKR',
  )
  if (nonLkrEntries.length === 0) return null

  const included = nonLkrEntries.filter((e) => !e.insufficientHistory)

  return (
    <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
      <h3 className="text-sm font-medium text-[var(--theme-text)]">
        FX gain/loss on foreign-currency holdings
      </h3>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        How much of your return is the asset's own price move vs. the LKR
        exchange rate moving since you bought it.
      </p>

      {included.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <div>
            <p className="text-xs text-[var(--theme-muted)]">Asset price gain</p>
            <p className={gainTone(fxGainLoss.totalAssetGainLkr)}>
              {signed(fxGainLoss.totalAssetGainLkr)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--theme-muted)]">FX movement</p>
            <p className={gainTone(fxGainLoss.totalFxGainLkr)}>
              {signed(fxGainLoss.totalFxGainLkr)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--theme-muted)]">Total return</p>
            <p className={gainTone(fxGainLoss.totalReturnLkr)}>
              {signed(fxGainLoss.totalReturnLkr)}
            </p>
          </div>
        </div>
      )}

      {included.length > 0 && (
        <div className="mt-3 grid gap-1">
          {included.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <span>
                {e.symbol} ({e.currency}, {e.quantity})
              </span>
              <span className="flex gap-3">
                <span className={gainTone(e.assetGainLkr)}>
                  price {signed(e.assetGainLkr)}
                </span>
                <span className={gainTone(e.fxGainLkr)}>
                  fx {signed(e.fxGainLkr)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {fxGainLoss.excludedCount > 0 && (
        <p className={`mt-2 text-xs ${warningTone}`}>
          {fxGainLoss.excludedCount} holding(s) excluded — no exchange-rate
          history on file back to their buy date.
        </p>
      )}
    </div>
  )
}
