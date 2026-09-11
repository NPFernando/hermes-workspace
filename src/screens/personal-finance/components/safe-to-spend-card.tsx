import { useState } from 'react'
import { formatLkr } from '../utils'
import { buttonClass, inputClass } from '../shared-styles'
import type { PersonalFinancePayload } from '../types'

export function SafeToSpendCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [draftReserve, setDraftReserve] = useState(
    String(payload.safeToSpend.reserveLkr),
  )
  const [saving, setSaving] = useState(false)
  const safe = payload.safeToSpend

  async function saveReserve() {
    const amountLkr = Number(draftReserve)
    if (!Number.isFinite(amountLkr) || amountLkr < 0) return
    setSaving(true)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_minimum_cash_reserve', amountLkr }),
      })
      const data = (await response.json()) as PersonalFinancePayload
      if (data.ok) onPayload(data)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Safe to spend</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            {safe.basis}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[var(--theme-muted)]">Available after reserve</p>
          <p className={`text-2xl font-semibold ${safe.amountLkr > 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-warning)]'}`}>
            {formatLkr(safe.amountLkr)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="minimum-cash-reserve" className="text-xs text-[var(--theme-muted)]">
          Minimum reserve (LKR)
        </label>
        <input
          id="minimum-cash-reserve"
          type="number"
          min="0"
          value={draftReserve}
          onChange={(e) => setDraftReserve(e.target.value)}
          className={`${inputClass} w-36`}
        />
        <button type="button" disabled={saving} onClick={() => void saveReserve()} className={buttonClass}>
          {saving ? 'Saving…' : safe.configured ? 'Update reserve' : 'Set reserve'}
        </button>
        <span className="text-xs text-[var(--theme-muted)]">
          Cash balance: {formatLkr(safe.cashLkr)}
        </span>
        <span className="text-xs text-[var(--theme-muted)]">
          Recurring commitments: {formatLkr(safe.committedLkr)}
        </span>
      </div>
    </section>
  )
}
