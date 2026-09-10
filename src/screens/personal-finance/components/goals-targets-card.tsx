import { useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr } from '../utils'
import { toneFor } from '../field-helpers'
import type { ReactNode } from 'react'
import type { PersonalFinancePayload } from '../types'

/**
 * PF review U2 (item 5): Emergency Fund, Savings Rate and Wealth Goal were
 * three near-identical "target vs progress bar" cards. This folds them into
 * one section with a consistent row per goal — each row still owns its own
 * set-form (months / percent / amount+date) and its own `set_*` action.
 */

const setInputClass =
  'rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm text-[var(--theme-text)]'
const setButtonClass =
  'rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-3 py-1 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_24%,transparent)] disabled:opacity-50'

function GoalRow({
  title,
  configured,
  percent,
  detail,
  note,
  form,
}: {
  title: string
  configured: boolean
  percent: number
  detail: ReactNode
  note?: ReactNode
  form: ReactNode
}) {
  const tone = toneFor(percent)
  return (
    <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--theme-text)]">
          {title}
        </h3>
        {configured && <span className={tone.text}>{percent}%</span>}
      </div>
      {configured ? (
        <>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)]">
            <div
              className={`h-full rounded-full ${tone.bar}`}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--theme-muted)]">{detail}</p>
          {note && <p className="mt-1 text-xs">{note}</p>}
        </>
      ) : (
        <div className="mt-2">{form}</div>
      )}
    </div>
  )
}

export function GoalsTargetsCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run, isBusy, error } = useFinanceAction<PersonalFinancePayload>(
    onPayload,
  )
  const c = payload.baseCurrency

  const ef = payload.emergencyFund
  const sr = payload.savingsRateTarget
  const wg = payload.wealthGoal

  const [efMonths, setEfMonths] = useState('6')
  const [srPct, setSrPct] = useState('20')
  const [wgTarget, setWgTarget] = useState('')
  const [wgDate, setWgDate] = useState('')

  const wgRemaining = wg.targetBase - wg.currentBase
  let wgNote: string | null = null
  if (wgRemaining > 0 && wg.targetDate) {
    const days = Math.ceil(
      (Date.parse(wg.targetDate) - Date.now()) / (24 * 60 * 60 * 1000),
    )
    if (Number.isFinite(days)) {
      wgNote =
        days <= 0
          ? 'Target date passed'
          : `Needs ${formatLkr(wgRemaining / Math.max(1, Math.ceil(days / 30)), c)}/mo to reach by ${wg.targetDate}`
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">
        Goals &amp; targets
      </h2>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <GoalRow
          title="Emergency fund"
          configured={ef.targetMonths > 0}
          percent={Math.round(ef.progressPct)}
          detail={
            <>
              {formatLkr(ef.currentBase, c)} / {formatLkr(ef.targetBase, c)} —{' '}
              {ef.coverageMonths.toFixed(1)} of {ef.targetMonths} months
            </>
          }
          note={
            ef.avgMonthlyExpensesBase === 0 ? (
              <span className="text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
                No complete month of expense history yet.
              </span>
            ) : undefined
          }
          form={
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={24}
                value={efMonths}
                onChange={(e) => setEfMonths(e.target.value)}
                className={`w-16 ${setInputClass}`}
              />
              <span className="text-xs text-[var(--theme-muted)]">months</span>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  const months = Number(efMonths)
                  if (Number.isFinite(months) && months > 0)
                    void run({ action: 'set_emergency_fund_target', months })
                }}
                className={setButtonClass}
              >
                Set
              </button>
            </div>
          }
        />

        <GoalRow
          title="Savings rate"
          configured={sr.targetPct > 0}
          percent={Math.round(sr.progressPct)}
          detail={
            <>
              {sr.actualPct.toFixed(1)}% of {sr.targetPct}% target (last 3
              months)
            </>
          }
          note={
            !sr.hasData ? (
              <span className="text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
                No complete month of history yet.
              </span>
            ) : undefined
          }
          form={
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={100}
                value={srPct}
                onChange={(e) => setSrPct(e.target.value)}
                className={`w-16 ${setInputClass}`}
              />
              <span className="text-xs text-[var(--theme-muted)]">%</span>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  const pct = Number(srPct)
                  if (Number.isFinite(pct) && pct > 0)
                    void run({ action: 'set_savings_rate_target', pct })
                }}
                className={setButtonClass}
              >
                Set
              </button>
            </div>
          }
        />

        <GoalRow
          title="Long-term wealth goal"
          configured={wg.targetBase > 0}
          percent={Math.round(wg.progressPct)}
          detail={
            <>
              {formatLkr(wg.currentBase, c)} / {formatLkr(wg.targetBase, c)}
            </>
          }
          note={
            wgNote ? (
              <span className="text-[var(--theme-muted)]">{wgNote}</span>
            ) : undefined
          }
          form={
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                placeholder={`Target (${c})`}
                value={wgTarget}
                onChange={(e) => setWgTarget(e.target.value)}
                className={`w-32 ${setInputClass}`}
              />
              <input
                type="date"
                value={wgDate}
                onChange={(e) => setWgDate(e.target.value)}
                title="Target date (optional)"
                className={setInputClass}
              />
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  const targetLkr = Number(wgTarget)
                  if (Number.isFinite(targetLkr) && targetLkr > 0)
                    void run({
                      action: 'set_wealth_goal',
                      targetLkr,
                      currency: c,
                      targetDate: wgDate || undefined,
                    })
                }}
                className={setButtonClass}
              >
                Set
              </button>
            </div>
          }
        />
      </div>
      {error && (
        <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>
      )}
    </section>
  )
}
