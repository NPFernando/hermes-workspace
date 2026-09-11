import { useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { buttonClass, inputClass } from '../shared-styles'
import { formatDateOnly, formatDateTime } from '../utils'
import type { PersonalFinancePayload } from '../types'

export function ExchangeRatesPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error, setError } =
    useFinanceAction<PersonalFinancePayload>(onPayload)
  const [base, setBase] = useState('LKR')
  const [target, setTarget] = useState('USD')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  async function saveRate() {
    const parsed = Number(rate)
    if (!base || !target || base === target || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Choose different currencies and enter a positive rate.')
      return
    }
    const data = await post(
      { action: 'set_exchange_rate', base, target, rate: parsed, date },
      'exchange-rate',
    )
    if (data) setRate('')
  }

  async function refreshRate() {
    await post(
      { action: 'refresh_exchange_rate', base, target },
      'exchange-rate-provider',
    )
  }

  return (
    <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Exchange rates</h2>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Add dated manual rates for currency conversion. Existing transactions keep their recorded rate.
      </p>
      <div className="mt-3 rounded-xl border border-[var(--theme-border)]/70 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Provider health</span>
          <span className="rounded-lg border border-[var(--theme-border)] px-2 py-0.5 uppercase tracking-wide text-[10px]">
            {payload.fxProviderHealth.status}
          </span>
          {payload.fxProviderHealth.lastObservedAt && (
            <span className="text-[var(--theme-muted)]">
              last observed {formatDateTime(payload.fxProviderHealth.lastObservedAt)}
            </span>
          )}
        </div>
        <p className="mt-1 text-[var(--theme-muted)]">{payload.fxProviderHealth.detail}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={base} onChange={(e) => setBase(e.target.value)} className={inputClass}>
          <option>LKR</option><option>USD</option><option>AUD</option><option>EUR</option><option>GBP</option>
        </select>
        <span className="text-xs text-[var(--theme-muted)]">to</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
          <option>USD</option><option>LKR</option><option>AUD</option><option>EUR</option><option>GBP</option>
        </select>
        <input type="number" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate for 1 base" className={`${inputClass} w-36`} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        <button type="button" disabled={busy === 'exchange-rate'} onClick={() => void saveRate()} className={buttonClass}>
          {busy === 'exchange-rate' ? 'Saving…' : 'Save rate'}
        </button>
        <button type="button" disabled={busy === 'exchange-rate-provider'} onClick={() => void refreshRate()} className={buttonClass}>
          {busy === 'exchange-rate-provider' ? 'Refreshing…' : 'Refresh provider rate'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
      {payload.exchangeRates.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {payload.exchangeRates.slice(0, 12).map((entry) => (
            <div key={`${entry.base}-${entry.target}-${entry.date}`} className="rounded-xl border border-[var(--theme-border)]/70 p-2 text-xs">
              <span className="font-medium">1 {entry.base} = {entry.rate} {entry.target}</span>
              <span className="ml-2 text-[var(--theme-muted)]">{formatDateOnly(entry.date)} · {entry.source ?? 'manual'}</span>
              {entry.observedAt && (
                <span className="ml-2 text-[10px] text-[var(--theme-muted)]">observed {formatDateTime(entry.observedAt)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
