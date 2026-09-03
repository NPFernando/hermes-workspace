import { useState } from 'react'
import { formatLkr } from '../utils'
import { toneFor } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

/**
 * PF-303/1005/1006: emergency fund target, tracked against real liquid cash
 * (cashBalanceLkr) rather than a manually-entered amount — the target itself
 * is set here as "N months of average expenses" since there's no dedicated
 * Financial Rules settings page (PF-301) yet.
 */
export function EmergencyFundCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [draftMonths, setDraftMonths] = useState('6')
  const [saving, setSaving] = useState(false)
  const ef = payload.emergencyFund

  async function saveTarget() {
    const months = Number(draftMonths)
    if (!Number.isFinite(months) || months <= 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_emergency_fund_target', months }),
      })
      const data = (await res.json()) as PersonalFinancePayload
      if (data.ok) onPayload(data)
    } finally {
      setSaving(false)
    }
  }

  if (ef.targetMonths === 0) {
    return (
      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          Emergency fund
        </h2>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          No target set yet. Choose how many months of average expenses you want
          covered.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={24}
            value={draftMonths}
            onChange={(e) => setDraftMonths(e.target.value)}
            className="w-20 rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm text-[var(--theme-text)]"
          />
          <span className="text-xs text-[var(--theme-muted)]">months</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveTarget()}
            className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-3 py-1 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_24%,transparent)] disabled:opacity-50"
          >
            Set target
          </button>
        </div>
      </section>
    )
  }

  const percent = Math.round(ef.progressPct)
  const tone = toneFor(percent)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          Emergency fund
        </h2>
        <span className={tone.text}>{percent}%</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)]">
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-[var(--theme-muted)]">
        {formatLkr(ef.currentLkr)} / {formatLkr(ef.targetLkr)} —{' '}
        {ef.coverageMonths.toFixed(1)} of {ef.targetMonths} months covered
      </p>
      {ef.avgMonthlyExpensesLkr === 0 && (
        <p className="mt-1 text-xs text-amber-300/80">
          No complete month of expense history yet — target amount will fill in
          once one is available.
        </p>
      )}
    </section>
  )
}
