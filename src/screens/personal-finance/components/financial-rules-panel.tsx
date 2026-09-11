import { useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { buttonClass, inputClass } from '../shared-styles'
import type { PersonalFinancePayload } from '../types'

export function FinancialRulesPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [monthlyInvestmentTargetLkr, setMonthlyInvestmentTargetLkr] = useState(
    String(payload.financialRules.monthlyInvestmentTargetLkr ?? ''),
  )
  const [largeTransactionThresholdLkr, setLargeTransactionThresholdLkr] = useState(
    String(payload.financialRules.largeTransactionThresholdLkr ?? ''),
  )
  const [discretionarySpendingThresholdLkr, setDiscretionarySpendingThresholdLkr] = useState(
    String(payload.financialRules.discretionarySpendingThresholdLkr ?? ''),
  )
  const [investmentAllocationTargetPct, setInvestmentAllocationTargetPct] = useState(
    String(payload.financialRules.investmentAllocationTargetPct ?? ''),
  )
  const { run: post, busy, error } = useFinanceAction<PersonalFinancePayload>(onPayload)

  async function save() {
    await post(
      {
        action: 'set_financial_rules',
        rules: {
          monthlyInvestmentTargetLkr: monthlyInvestmentTargetLkr || undefined,
          largeTransactionThresholdLkr: largeTransactionThresholdLkr || undefined,
          discretionarySpendingThresholdLkr:
            discretionarySpendingThresholdLkr || undefined,
          investmentAllocationTargetPct: investmentAllocationTargetPct || undefined,
        },
      },
      'financial-rules',
    )
  }

  return (
    <section className="mb-5 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div>
        <h2 className="text-lg font-semibold">Financial rules</h2>
        <p className="text-xs text-[var(--theme-muted)]">
          Optional thresholds for transparent future alerts and recommendations. Blank fields are disabled.
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-[var(--theme-muted)]">
          Monthly investment target (LKR)
          <input
            type="number"
            min="0"
            value={monthlyInvestmentTargetLkr}
            onChange={(event) => setMonthlyInvestmentTargetLkr(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--theme-muted)]">
          Large transaction threshold (LKR)
          <input
            type="number"
            min="0"
            value={largeTransactionThresholdLkr}
            onChange={(event) => setLargeTransactionThresholdLkr(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--theme-muted)]">
          Discretionary spending threshold (LKR)
          <input
            type="number"
            min="0"
            value={discretionarySpendingThresholdLkr}
            onChange={(event) => setDiscretionarySpendingThresholdLkr(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--theme-muted)]">
          Investment allocation target (%)
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={investmentAllocationTargetPct}
            onChange={(event) => setInvestmentAllocationTargetPct(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
      <button
        type="button"
        className={`${buttonClass} mt-3`}
        disabled={busy === 'financial-rules'}
        onClick={() => void save()}
      >
        {busy === 'financial-rules' ? 'Saving…' : 'Save rules'}
      </button>
    </section>
  )
}
