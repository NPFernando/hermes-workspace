import { useState } from 'react'
import { formatLkr } from '../utils'
import { toneFor } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

/**
 * WEALTH-107: long-term net worth target, compared against the already
 * -computed netWorthLkr (a point-in-time snapshot, so unlike PF-303/304
 * there's no lifetime-vs-period distinction to solve). Same
 * settings-driven-target pattern as EmergencyFundCard/SavingsRateTargetCard.
 */
export function WealthGoalCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [draftTargetLkr, setDraftTargetLkr] = useState('')
  const [draftTargetDate, setDraftTargetDate] = useState('')
  const [saving, setSaving] = useState(false)
  const wg = payload.wealthGoal

  async function saveTarget() {
    const targetLkr = Number(draftTargetLkr)
    if (!Number.isFinite(targetLkr) || targetLkr <= 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'set_wealth_goal',
          targetLkr,
          targetDate: draftTargetDate || undefined,
        }),
      })
      const data = (await res.json()) as PersonalFinancePayload
      if (data.ok) onPayload(data)
    } finally {
      setSaving(false)
    }
  }

  if (wg.targetLkr === 0) {
    return (
      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          Long-term wealth goal
        </h2>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          No target set yet. Choose a net worth target, and optionally a date to
          reach it by.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            placeholder="Target net worth (LKR)"
            value={draftTargetLkr}
            onChange={(e) => setDraftTargetLkr(e.target.value)}
            className="w-44 rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm text-[var(--theme-text)]"
          />
          <input
            type="date"
            value={draftTargetDate}
            onChange={(e) => setDraftTargetDate(e.target.value)}
            title="Target date (optional)"
            className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm text-[var(--theme-text)]"
          />
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

  const percent = Math.round(wg.progressPct)
  const tone = toneFor(percent)
  const remaining = wg.targetLkr - wg.currentLkr

  let requiredLine: { text: string; tone: string } | null = null
  if (remaining > 0 && wg.targetDate) {
    const daysUntil = Math.ceil(
      (Date.parse(wg.targetDate) - Date.now()) / (24 * 60 * 60 * 1000),
    )
    if (Number.isFinite(daysUntil)) {
      if (daysUntil <= 0) {
        requiredLine = { text: 'Target date passed', tone: 'text-[var(--theme-danger)]' }
      } else {
        const monthsUntil = Math.max(1, Math.ceil(daysUntil / 30))
        requiredLine = {
          text: `Needs ${formatLkr(remaining / monthsUntil)}/mo to reach by ${wg.targetDate}`,
          tone: 'text-[var(--theme-muted)]',
        }
      }
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          Long-term wealth goal
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
        {formatLkr(wg.currentLkr)} / {formatLkr(wg.targetLkr)}
      </p>
      {requiredLine && (
        <p className={`mt-1 text-xs ${requiredLine.tone}`}>
          {requiredLine.text}
        </p>
      )}
    </section>
  )
}
