import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatMoney } from '../utils'
import { buttonClass, confirmButtonClass, dangerButtonClass, inputClass } from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type PayoffProjection =
  | { insufficientPayment: true }
  | {
      insufficientPayment: false
      monthsRemaining: number
      totalInterest: number
      payoffDate: string
      termComparisonText?: string
    }

type PayoffScenario =
  | { insufficientPayment: true }
  | { insufficientPayment: false; monthsRemaining: number; totalInterest: number }

export type PayoffComparison = {
  baseline: PayoffScenario
  withExtra: PayoffScenario
  /** null when either scenario never pays off, or extraPayment <= 0. */
  monthsSaved: number | null
  interestSaved: number | null
}

/** Capped so a payment that barely covers interest can't spin the simulation
 *  loop for an unreasonable number of iterations — 600 months is 50 years,
 *  already well past any real loan term. */
const MAX_SIMULATION_MONTHS = 600

/**
 * Month-by-month amortization simulation rather than the closed-form
 * payoff-time formula — needed to also get an exact total-interest figure
 * (a closed form gives months-to-payoff but not total interest paid,
 * particularly with the last month's partial payment). `monthlyPayment` is
 * the full payment actually applied each month, extra payment included.
 */
function simulatePayoff(
  currentBalance: number,
  interestRatePct: number,
  monthlyPayment: number,
): PayoffScenario {
  if (monthlyPayment <= 0 || currentBalance <= 0) {
    return { insufficientPayment: true }
  }
  const r = interestRatePct / 100 / 12
  if (r > 0 && monthlyPayment <= currentBalance * r) {
    return { insufficientPayment: true }
  }

  let balance = currentBalance
  let totalInterest = 0
  let months = 0
  while (balance > 0 && months < MAX_SIMULATION_MONTHS) {
    const interest = balance * r
    const principal = Math.min(monthlyPayment - interest, balance)
    balance -= principal
    totalInterest += interest
    months += 1
  }
  return { insufficientPayment: false, monthsRemaining: months, totalInterest }
}

/**
 * WEALTH-104/105: pure client-side projection from fields the loan already
 * has — no server/payload changes, mirroring PF-1008's sinking-fund
 * schedule-status precedent. Elapsed time since startDate isn't factored in
 * (this projects forward from currentBalance as of now, not a full
 * historical schedule reconciliation).
 */
export function payoffProjection(
  loan: Record<string, unknown>,
): PayoffProjection | null {
  const currentBalance = numberField(loan, 'currentBalance')
  const interestRatePct = numberField(loan, 'interestRatePct')
  const monthlyPayment = numberField(loan, 'monthlyPayment')
  const termMonths = numberField(loan, 'termMonths')
  if ((stringField(loan, 'status') || 'active') !== 'active') return null
  if (monthlyPayment <= 0 || currentBalance <= 0) return null

  const scenario = simulatePayoff(currentBalance, interestRatePct, monthlyPayment)
  if (scenario.insufficientPayment) return { insufficientPayment: true }

  const payoff = new Date()
  payoff.setMonth(payoff.getMonth() + scenario.monthsRemaining)
  const payoffDate = payoff.toISOString().slice(0, 10)

  let termComparisonText: string | undefined
  if (termMonths > 0) {
    const diff = scenario.monthsRemaining - termMonths
    termComparisonText =
      diff <= 0
        ? `within the original ${termMonths}-month term`
        : `~${diff} months longer than the original ${termMonths}-month term`
  }

  return {
    insufficientPayment: false,
    monthsRemaining: scenario.monthsRemaining,
    totalInterest: scenario.totalInterest,
    payoffDate,
    termComparisonText,
  }
}

/**
 * "What if I paid extra?" — compares the scheduled monthly payment against
 * that payment plus `extraMonthlyPayment`, both simulated from the loan's
 * current balance. Pure and client-side (no server round trip), so a
 * calculator UI can recompute on every keystroke.
 */
export function payoffComparison(
  loan: Record<string, unknown>,
  extraMonthlyPayment: number,
): PayoffComparison | null {
  const currentBalance = numberField(loan, 'currentBalance')
  const interestRatePct = numberField(loan, 'interestRatePct')
  const monthlyPayment = numberField(loan, 'monthlyPayment')
  if ((stringField(loan, 'status') || 'active') !== 'active') return null
  if (monthlyPayment <= 0 || currentBalance <= 0) return null

  const baseline = simulatePayoff(currentBalance, interestRatePct, monthlyPayment)
  const withExtra = simulatePayoff(
    currentBalance,
    interestRatePct,
    monthlyPayment + Math.max(0, extraMonthlyPayment),
  )

  const canCompare =
    extraMonthlyPayment > 0 &&
    !baseline.insufficientPayment &&
    !withExtra.insufficientPayment

  return {
    baseline,
    withExtra,
    monthsSaved: canCompare
      ? (baseline as { monthsRemaining: number }).monthsRemaining -
        (withExtra as { monthsRemaining: number }).monthsRemaining
      : null,
    interestSaved: canCompare
      ? (baseline as { totalInterest: number }).totalInterest -
        (withExtra as { totalInterest: number }).totalInterest
      : null,
  }
}

/**
 * Phase 40 (WEALTH-100/101): dedicated loan tracking — principal is the
 * original amount, currentBalance is the remaining balance the user updates
 * as they pay it down (unlike FixedDeposit's principal, which never
 * changes). currentBalance feeds financeSummary()'s debtBase when active.
 */
function PayoffCalculator({
  loan,
  currency,
  extraPayment,
  onExtraPaymentChange,
}: {
  loan: Record<string, unknown>
  currency: string
  extraPayment: string
  onExtraPaymentChange: (value: string) => void
}) {
  const extra = Number(extraPayment) || 0
  const comparison = payoffComparison(loan, extra)

  return (
    <div className="mt-2 rounded-xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_5%,transparent)] p-3">
      <p className="text-xs font-medium text-[var(--theme-text)]">
        What if I paid extra each month?
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          placeholder="Extra monthly payment"
          value={extraPayment}
          onChange={(e) => onExtraPaymentChange(e.target.value)}
          className={`${inputClass} w-44`}
        />
        <span className="text-xs text-[var(--theme-muted)]">{currency}/month</span>
      </div>
      {comparison && extra > 0 && (
        <p className="mt-2 text-xs text-[var(--theme-muted)]">
          {comparison.withExtra.insufficientPayment ? (
            'Still not enough to cover interest.'
          ) : comparison.monthsSaved !== null &&
            comparison.interestSaved !== null ? (
            <>
              Paying off in ~{comparison.withExtra.monthsRemaining} months
              instead of ~
              {(comparison.baseline as { monthsRemaining: number })
                .monthsRemaining}{' '}
              — {comparison.monthsSaved} month
              {comparison.monthsSaved === 1 ? '' : 's'} sooner, saving ~
              {formatMoney(comparison.interestSaved, currency)} in interest.
            </>
          ) : (
            'The scheduled payment alone never covers interest — extra payments alone won\'t fix that; check the interest rate and monthly payment.'
          )}
        </p>
      )}
    </div>
  )
}

export function LoansPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const {
    run: post,
    busy,
    error: err,
    setError: setErr,
  } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [calculatorOpenId, setCalculatorOpenId] = useState<string | null>(null)
  const [extraPaymentDrafts, setExtraPaymentDrafts] = useState<
    Record<string, string>
  >({})
  const [editDrafts, setEditDrafts] = useState<
    Record<
      string,
      {
        lender: string
        principal: string
        currentBalance: string
        currency: string
        interestRatePct: string
        monthlyPayment: string
        startDate: string
        termMonths: string
        status: string
        notes: string
      }
    >
  >({})

  const [lender, setLender] = useState('')
  const [principal, setPrincipal] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')
  const [currency, setCurrency] = useState('LKR')
  const [interestRatePct, setInterestRatePct] = useState('')
  const [monthlyPayment, setMonthlyPayment] = useState('')
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [termMonths, setTermMonths] = useState('')
  const [notes, setNotes] = useState('')

  async function submitLoan() {
    if (!lender.trim()) {
      setErr('Lender is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'loan',
        payload: {
          lender: lender.trim(),
          principal: Number(principal) || 0,
          currentBalance: Number(currentBalance) || Number(principal) || 0,
          currency,
          interestRatePct: Number(interestRatePct) || 0,
          monthlyPayment: monthlyPayment ? Number(monthlyPayment) : undefined,
          startDate,
          termMonths: termMonths ? Number(termMonths) : undefined,
          notes: notes.trim() || undefined,
        },
      },
      'loan',
    )
    if (data) {
      setLender('')
      setPrincipal('')
      setCurrentBalance('')
      setInterestRatePct('')
      setMonthlyPayment('')
      setTermMonths('')
      setNotes('')
    }
  }

  async function deleteLoan(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'loan', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  function startEdit(loan: Record<string, unknown>) {
    const id = stringField(loan, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        lender: stringField(loan, 'lender'),
        principal: String(numberField(loan, 'principal')),
        currentBalance: String(numberField(loan, 'currentBalance')),
        currency: stringField(loan, 'currency') || 'LKR',
        interestRatePct: String(numberField(loan, 'interestRatePct')),
        monthlyPayment:
          loan.monthlyPayment != null
            ? String(numberField(loan, 'monthlyPayment'))
            : '',
        startDate: stringField(loan, 'startDate'),
        termMonths:
          loan.termMonths != null
            ? String(numberField(loan, 'termMonths'))
            : '',
        status: stringField(loan, 'status') || 'active',
        notes: stringField(loan, 'notes'),
      },
    }))
    setEditOpenId(id)
  }

  function cancelEdit() {
    setEditOpenId(null)
  }

  async function saveEdit(id: string) {
    const draft = editDrafts[id]
    if (!draft.lender.trim()) {
      setErr('Lender is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'loan',
        id,
        payload: {
          lender: draft.lender.trim(),
          principal: Number(draft.principal) || 0,
          currentBalance: Number(draft.currentBalance) || 0,
          currency: draft.currency,
          interestRatePct: Number(draft.interestRatePct) || 0,
          monthlyPayment: draft.monthlyPayment
            ? Number(draft.monthlyPayment)
            : undefined,
          startDate: draft.startDate,
          termMonths: draft.termMonths ? Number(draft.termMonths) : undefined,
          status: draft.status,
          notes: draft.notes.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  const loans = payload.data.loans

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Loans</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Track what you owe — principal is the original amount, current balance
        is what's left as you pay it down.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Lender"
          value={lender}
          onChange={(e) => setLender(e.target.value)}
          className={inputClass}
        />
        <input
          type="number"
          placeholder="Principal"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
          className={`${inputClass} w-28`}
        />
        <input
          type="number"
          placeholder="Current balance"
          value={currentBalance}
          onChange={(e) => setCurrentBalance(e.target.value)}
          className={`${inputClass} w-32`}
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className={inputClass}
        >
          <option value="LKR">LKR</option>
          <option value="USD">USD</option>
        </select>
        <input
          type="number"
          placeholder="Interest rate % (p.a.)"
          value={interestRatePct}
          onChange={(e) => setInterestRatePct(e.target.value)}
          className={`${inputClass} w-32`}
        />
        <input
          type="number"
          placeholder="Monthly payment (optional)"
          value={monthlyPayment}
          onChange={(e) => setMonthlyPayment(e.target.value)}
          className={`${inputClass} w-36`}
        />
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className={inputClass}
          title="Start date"
        />
        <input
          type="number"
          placeholder="Term (months, optional)"
          value={termMonths}
          onChange={(e) => setTermMonths(e.target.value)}
          className={`${inputClass} w-36`}
        />
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
        <button
          type="button"
          disabled={busy === 'loan'}
          onClick={() => void submitLoan()}
          className={buttonClass}
        >
          {busy === 'loan' ? 'Saving…' : 'Add loan'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-[var(--theme-danger)]">{err}</p>}

      <div className="mt-4 grid gap-2">
        {loans.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No loans added yet.
          </p>
        )}
        {loans.map((loan, index) => {
          const id = stringField(loan, 'id') || String(index)
          const loanCurrency = stringField(loan, 'currency') || 'LKR'
          const status = stringField(loan, 'status') || 'active'
          const isEditing = editOpenId === id
          const projection = payoffProjection(loan)
          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Lender"
                    value={editDrafts[id].lender}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], lender: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="number"
                    placeholder="Principal"
                    value={editDrafts[id].principal}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], principal: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-28`}
                  />
                  <input
                    type="number"
                    placeholder="Current balance"
                    value={editDrafts[id].currentBalance}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], currentBalance: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-32`}
                  />
                  <select
                    value={editDrafts[id].currency}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], currency: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="LKR">LKR</option>
                    <option value="USD">USD</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Interest rate %"
                    value={editDrafts[id].interestRatePct}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], interestRatePct: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-32`}
                  />
                  <input
                    type="number"
                    placeholder="Monthly payment"
                    value={editDrafts[id].monthlyPayment}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], monthlyPayment: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-36`}
                  />
                  <input
                    type="date"
                    value={editDrafts[id].startDate}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], startDate: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="number"
                    placeholder="Term (months)"
                    value={editDrafts[id].termMonths}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], termMonths: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-36`}
                  />
                  <select
                    value={editDrafts[id].status}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], status: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="active">Active</option>
                    <option value="paid_off">Paid off</option>
                    <option value="defaulted">Defaulted</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={editDrafts[id].notes}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], notes: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={busy === `edit-${id}`}
                    onClick={() => void saveEdit(id)}
                    className={confirmButtonClass}
                  >
                    {busy === `edit-${id}` ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className={buttonClass}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-[var(--theme-text)]">
                      {stringField(loan, 'lender')}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      ·{' '}
                      {formatMoney(
                        numberField(loan, 'currentBalance'),
                        loanCurrency,
                      )}{' '}
                      of{' '}
                      {formatMoney(
                        numberField(loan, 'principal'),
                        loanCurrency,
                      )}{' '}
                      remaining · {numberField(loan, 'interestRatePct')}% ·{' '}
                      {status}
                    </span>
                    {stringField(loan, 'notes') && (
                      <p className="mt-1 text-xs text-[var(--theme-muted)]">
                        {stringField(loan, 'notes')}
                      </p>
                    )}
                    {projection &&
                      (projection.insufficientPayment ? (
                        <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
                          Monthly payment doesn't cover interest — balance will
                          grow.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-[var(--theme-muted)]">
                          Paying off in ~{projection.monthsRemaining} months (~
                          {projection.payoffDate})
                          {projection.termComparisonText &&
                            ` — ${projection.termComparisonText}`}
                        </p>
                      ))}
                  </div>
                  <div className="flex gap-2">
                    {projection && !projection.insufficientPayment && (
                      <button
                        type="button"
                        onClick={() =>
                          setCalculatorOpenId(
                            calculatorOpenId === id ? null : id,
                          )
                        }
                        className={buttonClass}
                      >
                        {calculatorOpenId === id
                          ? 'Hide calculator'
                          : 'Payoff calculator'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(loan)}
                      className={buttonClass}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy === `delete-${id}`}
                      onClick={() => setConfirmDeleteId(id)}
                      className={dangerButtonClass}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
              {!isEditing && calculatorOpenId === id && (
                <PayoffCalculator
                  loan={loan}
                  currency={loanCurrency}
                  extraPayment={extraPaymentDrafts[id] ?? ''}
                  onExtraPaymentChange={(value) =>
                    setExtraPaymentDrafts((prev) => ({
                      ...prev,
                      [id]: value,
                    }))
                  }
                />
              )}
            </div>
          )
        })}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this loan?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteLoan(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
