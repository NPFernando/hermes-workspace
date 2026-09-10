import { useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { fetchPersonalFinancePayload } from '../personal-finance-queries'
import type { PersonalFinancePayload } from '../types'

/**
 * PF-201: picks the reporting currency all aggregate figures on this dashboard
 * are expressed in. Storage stays LKR-denominated — this is display only. When
 * a non-LKR currency is chosen an `<currency>`↔`LKR` exchange rate must be on
 * file, otherwise figures fall back to their raw LKR value and show up in the
 * "missing exchange rate" alert. The FX cron (`refresh_exchange_rates`) keeps
 * `data.exchange_rates` current; "Refresh now" runs it on demand.
 */
// Mirrors SUPPORTED_CURRENCIES in src/server/finance-store.ts.
const CURRENCIES = ['LKR', 'AUD', 'USD'] as const

const DAY_MS = 24 * 60 * 60 * 1000
const STALE_DAYS = 2

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
  const options = CURRENCIES.includes(current as (typeof CURRENCIES)[number])
    ? CURRENCIES
    : [current, ...CURRENCIES]

  async function pick(currency: string) {
    if (currency === current) return
    await run({ action: 'set_base_currency', currency })
  }

  const missingRate = payload.summary.fxUnconverted?.includes(current)

  // Item 1 + 4: "rates as of …" + staleness. `refresh_exchange_rates` returns a
  // maintenance JSON (not a PersonalFinancePayload), so it can't go through
  // useFinanceAction — do a bespoke call and re-pull the payload for the fresh
  // `data.exchange_rates`.
  const rates = payload.data.exchange_rates
  const newestDate = rates.reduce((m, r) => (r.date > m ? r.date : m), '')
  const daysOld = newestDate
    ? Math.floor((Date.now() - Date.parse(newestDate)) / DAY_MS)
    : null
  const stale = daysOld !== null && daysOld > STALE_DAYS

  const [fxBusy, setFxBusy] = useState(false)
  const [fxMsg, setFxMsg] = useState<string | null>(null)

  async function refreshRates() {
    setFxBusy(true)
    setFxMsg(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_exchange_rates' }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        updated?: Array<{ pair: string }>
        failed?: Array<string>
      }
      if (!res.ok || !data.ok) {
        setFxMsg(data.error ?? 'Refresh failed.')
        return
      }
      const pairs = (data.updated ?? []).map((u) => u.pair)
      setFxMsg(
        pairs.length ? `Updated ${pairs.join(', ')}.` : 'Rates already current.',
      )
      if (data.failed?.length) {
        setFxMsg((m) => `${m ?? ''} No rate for ${data.failed!.join(', ')}.`)
      }
      onPayload(await fetchPersonalFinancePayload())
    } catch {
      setFxMsg('Refresh failed.')
    } finally {
      setFxBusy(false)
    }
  }

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

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--theme-muted)]">
        <span>
          {newestDate
            ? `Exchange rates as of ${newestDate}`
            : 'No exchange rates on file yet'}
          {stale && (
            <span className="text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
              {' '}
              — {daysOld} days old, may be out of date
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void refreshRates()}
          disabled={fxBusy}
          className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)] px-2 py-0.5 font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_20%,transparent)] disabled:opacity-50"
        >
          {fxBusy ? 'Refreshing…' : 'Refresh now'}
        </button>
      </p>

      {missingRate && (
        <p className="mt-2 text-xs text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
          No LKR↔{current} exchange rate on file — figures are showing their raw
          LKR value. Use “Refresh now”, or add a rate under Accounts &amp;
          Records.
        </p>
      )}
      {fxMsg && (
        <p className="mt-2 text-xs text-[var(--theme-muted)]">{fxMsg}</p>
      )}
      {error && (
        <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>
      )}
    </section>
  )
}
