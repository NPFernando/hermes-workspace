import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import type { PersonalFinancePayload } from '../types'

/**
 * PF-201: picks the reporting currency all aggregate figures on this dashboard
 * are expressed in. Storage stays LKR-denominated — this is display only. When
 * a non-LKR currency is chosen an `<currency>`↔`LKR` exchange rate must be on
 * file (Records → exchange rates), otherwise figures fall back to their raw LKR
 * value and show up in the "missing exchange rate" alert.
 */
// Mirrors SUPPORTED_CURRENCIES in src/server/finance-store.ts.
const CURRENCIES = ['LKR', 'AUD', 'USD'] as const

export function BaseCurrencySelect({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run, isBusy, error } = useFinanceAction<PersonalFinancePayload>(
    onPayload,
  )
  const current = payload.baseCurrency
  const options = CURRENCIES.includes(
    current as (typeof CURRENCIES)[number],
  )
    ? CURRENCIES
    : [current, ...CURRENCIES]

  async function pick(currency: string) {
    if (currency === current) return
    await run({ action: 'set_base_currency', currency })
  }

  const missingRate = payload.summary.fxUnconverted?.includes(current)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">
            Reporting currency
          </h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Aggregate figures are shown in this currency. Records stay stored in
            LKR.
          </p>
        </div>
        <select
          value={current}
          disabled={isBusy}
          onChange={(e) => void pick(e.target.value)}
          className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-3 py-1.5 text-sm text-[var(--theme-text)] disabled:opacity-50"
        >
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {missingRate && (
        <p className="mt-2 text-xs text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
          No LKR↔{current} exchange rate on file — figures are showing their raw
          LKR value. Add a rate under Accounts &amp; Records.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>
      )}
    </section>
  )
}
