import { useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { buttonClass, inputClass } from '../shared-styles'
import type { PersonalFinancePayload } from '../types'

const CURRENCIES = ['LKR', 'AUD', 'USD'] as const

/** PF-201: changes the reporting currency without rewriting historical records. */
export function BaseCurrencyPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error } =
    useFinanceAction<PersonalFinancePayload>(onPayload)
  const [currency, setCurrency] = useState(payload.baseCurrency ?? 'LKR')

  async function save() {
    await post({ action: 'set_base_currency', baseCurrency: currency }, 'base-currency')
  }

  return (
    <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Reporting currency</h2>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Overview valuation summaries use this currency. Historical records and their original currencies stay unchanged.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className={inputClass}
          aria-label="Reporting currency"
        >
          {CURRENCIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy === 'base-currency' || currency === (payload.baseCurrency ?? 'LKR')}
          onClick={() => void save()}
          className={buttonClass}
        >
          {busy === 'base-currency' ? 'Saving…' : 'Save reporting currency'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
    </section>
  )
}
