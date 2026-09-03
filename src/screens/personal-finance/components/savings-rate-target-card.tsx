import { useState } from 'react'
import { toneFor } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

/**
 * PF-304: savings rate target, in percent — compared against a trailing
 * 3-month ratio-of-sums actual rate (getAverageMonthlySavingsRatePct), not
 * the lifetime-cumulative summary.savingsRate shown elsewhere in the app
 * (Trading screen, Dashboard) — those are deliberately left untouched.
 */
export function SavingsRateTargetCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [draftPct, setDraftPct] = useState('20')
  const [saving, setSaving] = useState(false)
  const sr = payload.savingsRateTarget

  async function saveTarget() {
    const pct = Number(draftPct)
    if (!Number.isFinite(pct) || pct <= 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_savings_rate_target', pct }),
      })
      const data = (await res.json()) as PersonalFinancePayload
      if (data.ok) onPayload(data)
    } finally {
      setSaving(false)
    }
  }

  if (sr.targetPct === 0) {
    return (
      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          Savings rate target
        </h2>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          No target set yet. Choose what share of income you want to save each
          month.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={100}
            value={draftPct}
            onChange={(e) => setDraftPct(e.target.value)}
            className="w-20 rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm text-[var(--theme-text)]"
          />
          <span className="text-xs text-[var(--theme-muted)]">%</span>
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

  const percent = Math.round(sr.progressPct)
  const tone = toneFor(percent)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          Savings rate target
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
        {sr.actualPct.toFixed(1)}% of {sr.targetPct}% target (last 3 months)
      </p>
      {!sr.hasData && (
        <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
          No complete month of income/expense history yet — actual rate will
          fill in once one is available.
        </p>
      )}
    </section>
  )
}
