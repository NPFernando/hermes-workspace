import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatDateOnly, formatMoney } from '../utils'
import { buttonClass, dangerButtonClass, dangerTone, inputClass, neutralTone, warningTone } from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

export function daysUntil(dateStr: string): number | null {
  const target = Date.parse(dateStr)
  if (!Number.isFinite(target)) return null
  return Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000))
}

const maturityTone = {
  ok: neutralTone,
  soon: warningTone,
  overdue: dangerTone,
}

export function maturityBadge(remaining: number): {
  text: string
  tone: string
} {
  if (remaining >= 0) {
    const text = `Matures in ${remaining}d`
    return { text, tone: remaining <= 30 ? maturityTone.soon : maturityTone.ok }
  }
  const overdue = Math.abs(remaining)
  const text = `Matured ${overdue}d ago`
  return { text, tone: overdue <= 7 ? maturityTone.soon : maturityTone.overdue }
}

/** PF-1107: transparent simple-interest estimate; bank compounding, tax, and
 * already-paid periodic interest are intentionally not inferred. */
export function estimatedMaturityValue(
  principal: number,
  annualRatePct: number,
  startDate: string,
  maturityDate: string,
): number | null {
  const start = Date.parse(startDate)
  const maturity = Date.parse(maturityDate)
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(maturity) ||
    maturity < start ||
    !Number.isFinite(principal) ||
    principal < 0 ||
    !Number.isFinite(annualRatePct) ||
    annualRatePct < 0
  )
    return null
  const years = (maturity - start) / (365 * 24 * 60 * 60 * 1000)
  return principal * (1 + (annualRatePct / 100) * years)
}

/** PF-1103: simple-interest accrual through `asOf`, capped to the deposit term. */
export function estimatedAccruedInterest(
  principal: number,
  annualRatePct: number,
  startDate: string,
  maturityDate: string,
  asOf = new Date(),
): number | null {
  const start = Date.parse(startDate)
  const maturity = Date.parse(maturityDate)
  const asOfMs = asOf.getTime()
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(maturity) ||
    !Number.isFinite(asOfMs) ||
    maturity < start ||
    !Number.isFinite(principal) ||
    principal < 0 ||
    !Number.isFinite(annualRatePct) ||
    annualRatePct < 0
  )
    return null
  const elapsedDays = Math.max(0, Math.min(maturity, asOfMs) - start) /
    (24 * 60 * 60 * 1000)
  return principal * (annualRatePct / 100) * (elapsedDays / 365)
}

type InterestPayoutFrequency =
  | 'monthly'
  | 'quarterly'
  | 'annually'
  | 'at_maturity'

function addMonthsClamped(date: Date, months: number, anchorDay = date.getUTCDate()): Date {
  const next = new Date(date)
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate()
  next.setUTCDate(Math.min(anchorDay, lastDay))
  return next
}

/** PF-1102: returns the next scheduled payout within the deposit term. */
export function nextInterestPayoutDate(
  startDate: string,
  maturityDate: string,
  frequency: InterestPayoutFrequency,
  asOf = new Date(),
): string | null {
  const start = new Date(`${startDate}T12:00:00.000Z`)
  const maturity = new Date(`${maturityDate}T12:00:00.000Z`)
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(maturity.getTime()) ||
    maturity < start ||
    Number.isNaN(asOf.getTime())
  )
    return null
  if (!['monthly', 'quarterly', 'annually', 'at_maturity'].includes(frequency)) return null
  if (frequency === 'at_maturity') {
    return maturity > asOf ? maturityDate : null
  }
  const interval = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12
  const anchorDay = start.getUTCDate()
  let candidate = start
  while (candidate <= asOf)
    candidate = addMonthsClamped(candidate, interval, anchorDay)
  if (candidate > maturity) return null
  return candidate.toISOString().slice(0, 10)
}

export type FixedDepositLadderEntry = {
  id: string
  bankName: string
  maturityDate: string
  principal: number
  currency: string
  status: string
  autoRenew: boolean
}

type FixedDepositEditDraft = {
  bankName: string
  principal: string
  currency: string
  interestRatePct: string
  interestReceived: string
  taxDeducted: string
  payoutAccountId: string
  autoRenew: boolean
  interestPayout: InterestPayoutFrequency
  startDate: string
  maturityDate: string
  notes: string
}

/** PF-1110: stable chronological view data; invalid dates stay out of the ladder. */
export function buildFixedDepositLadder(
  deposits: Array<Record<string, unknown>>,
): Array<FixedDepositLadderEntry> {
  return deposits
    .map((deposit, index) => ({
      id: stringField(deposit, 'id') || String(index),
      bankName: stringField(deposit, 'bankName') || 'Unnamed bank',
      maturityDate: stringField(deposit, 'maturityDate'),
      principal: numberField(deposit, 'principal'),
      currency: stringField(deposit, 'currency') || 'LKR',
      status: stringField(deposit, 'status') || 'active',
      autoRenew: deposit.autoRenew === true,
    }))
    .filter((entry) => Number.isFinite(Date.parse(entry.maturityDate)))
    .sort((a, b) => {
      const dateOrder = Date.parse(a.maturityDate) - Date.parse(b.maturityDate)
      return dateOrder || a.bankName.localeCompare(b.bankName)
    })
}

export function FixedDepositsPanel({
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
  const [editDrafts, setEditDrafts] = useState<Record<string, FixedDepositEditDraft>>({})

  const [bankName, setBankName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [currency, setCurrency] = useState('LKR')
  const [interestRatePct, setInterestRatePct] = useState('')
  const [interestReceived, setInterestReceived] = useState('')
  const [taxDeducted, setTaxDeducted] = useState('')
  const [payoutAccountId, setPayoutAccountId] = useState('')
  const [autoRenew, setAutoRenew] = useState(false)
  const [interestPayout, setInterestPayout] = useState<
    'monthly' | 'quarterly' | 'annually' | 'at_maturity'
  >('at_maturity')
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [maturityDate, setMaturityDate] = useState('')
  const [notes, setNotes] = useState('')

  async function submitFd() {
    if (!bankName.trim() || !maturityDate) {
      setErr('Bank name and maturity date are required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'fixed_deposit',
        payload: {
          bankName: bankName.trim(),
          principal: Number(principal) || 0,
          currency,
          interestRatePct: Number(interestRatePct) || 0,
          interestPayout,
          interestReceived: interestReceived.trim() ? Number(interestReceived) : undefined,
          taxDeducted: taxDeducted.trim() ? Number(taxDeducted) : undefined,
          payoutAccountId: payoutAccountId || undefined,
          autoRenew,
          startDate,
          maturityDate,
          notes: notes.trim() || undefined,
        },
      },
      'fd',
    )
    if (data) {
      setBankName('')
      setPrincipal('')
      setInterestRatePct('')
      setInterestReceived('')
      setTaxDeducted('')
      setPayoutAccountId('')
      setAutoRenew(false)
      setMaturityDate('')
      setNotes('')
    }
  }

  async function markMatured(id: string) {
    await post(
      {
        action: 'update_record',
        kind: 'fixed_deposit',
        id,
        payload: { status: 'matured' },
      },
      `mature-${id}`,
    )
  }

  function startEdit(fd: Record<string, unknown>) {
    const id = stringField(fd, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        bankName: stringField(fd, 'bankName'),
        principal: String(numberField(fd, 'principal')),
        currency: stringField(fd, 'currency') || 'LKR',
        interestRatePct: String(numberField(fd, 'interestRatePct')),
        interestReceived: fd.interestReceived === undefined ? '' : String(numberField(fd, 'interestReceived')),
        taxDeducted: fd.taxDeducted === undefined ? '' : String(numberField(fd, 'taxDeducted')),
        payoutAccountId: stringField(fd, 'payoutAccountId'),
        autoRenew: fd.autoRenew === true,
        interestPayout: (stringField(fd, 'interestPayout') || 'at_maturity') as InterestPayoutFrequency,
        startDate: stringField(fd, 'startDate'),
        maturityDate: stringField(fd, 'maturityDate'),
        notes: stringField(fd, 'notes'),
      },
    }))
    setEditOpenId(id)
  }

  async function saveEdit(id: string) {
    const draft = editDrafts[id]
    if (!draft.bankName.trim() || !draft.maturityDate) {
      setErr('Bank name and maturity date are required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'fixed_deposit',
        id,
        payload: {
          bankName: draft.bankName.trim(),
          principal: Number(draft.principal) || 0,
          currency: draft.currency,
          interestRatePct: Number(draft.interestRatePct) || 0,
          interestReceived: draft.interestReceived.trim() ? Number(draft.interestReceived) : undefined,
          taxDeducted: draft.taxDeducted.trim() ? Number(draft.taxDeducted) : undefined,
          payoutAccountId: draft.payoutAccountId || undefined,
          autoRenew: draft.autoRenew,
          interestPayout: draft.interestPayout,
          startDate: draft.startDate,
          maturityDate: draft.maturityDate,
          notes: draft.notes.trim() || undefined,
        },
      },
      `edit-fd-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function markWithdrawn(id: string) {
    await post(
      {
        action: 'update_record',
        kind: 'fixed_deposit',
        id,
        payload: { status: 'withdrawn' },
      },
      `withdraw-${id}`,
    )
  }

  async function deleteFd(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'fixed_deposit', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  const deposits = payload.data.fixed_deposits
  const accounts = payload.data.finance_accounts
  const ladder = buildFixedDepositLadder(deposits)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Fixed deposits</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Track principal, the annual interest rate, and when interest pays out —
        monthly, quarterly, annually, or all at maturity.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Bank name"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          className={inputClass}
        />
        <input
          type="number"
          placeholder="Principal"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
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
        <label className="flex items-center gap-2 px-1 text-xs text-[var(--theme-muted)]">
          <input
            type="checkbox"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
          />
          Auto-renew preference
        </label>
        <input
          type="number"
          min="0"
          placeholder="Interest received"
          value={interestReceived}
          onChange={(e) => setInterestReceived(e.target.value)}
          className={`${inputClass} w-32`}
          title="Gross interest already received (optional)"
        />
        <input
          type="number"
          min="0"
          placeholder="Tax deducted"
          value={taxDeducted}
          onChange={(e) => setTaxDeducted(e.target.value)}
          className={`${inputClass} w-32`}
          title="Tax or withholding deducted from received interest (optional)"
        />
        <select
          value={payoutAccountId}
          onChange={(e) => setPayoutAccountId(e.target.value)}
          className={inputClass}
          title="Optional account where interest is paid"
        >
          <option value="">Payout account (optional)</option>
          {accounts.map((account) => {
            const id = stringField(account, 'id')
            const name = stringField(account, 'name') || 'Unnamed account'
            const accountCurrency = stringField(account, 'currency') || 'LKR'
            return (
              <option key={id} value={id}>
                {name} · {accountCurrency}
              </option>
            )
          })}
        </select>
        <input
          type="number"
          placeholder="Interest rate % (p.a.)"
          value={interestRatePct}
          onChange={(e) => setInterestRatePct(e.target.value)}
          className={`${inputClass} w-32`}
        />
        <select
          value={interestPayout}
          onChange={(e) =>
            setInterestPayout(e.target.value as typeof interestPayout)
          }
          className={inputClass}
        >
          <option value="monthly">Monthly interest</option>
          <option value="quarterly">Quarterly interest</option>
          <option value="annually">Annual interest</option>
          <option value="at_maturity">All at maturity</option>
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className={inputClass}
          title="Start date"
        />
        <input
          type="date"
          value={maturityDate}
          onChange={(e) => setMaturityDate(e.target.value)}
          className={inputClass}
          title="Maturity date"
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
          disabled={busy === 'fd'}
          onClick={() => void submitFd()}
          className={buttonClass}
        >
          {busy === 'fd' ? 'Saving…' : 'Add fixed deposit'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-[var(--theme-danger)]">{err}</p>}

      {ladder.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/70 p-3">
          <h3 className="text-sm font-semibold">Maturity ladder</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Chronological view of principal returning at maturity. Auto-renew is a preference only.
          </p>
          <div className="mt-2 grid gap-1">
            {ladder.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] px-3 py-2 text-xs"
              >
                <span>
                  <span className="font-medium">{formatDateOnly(entry.maturityDate)}</span>{' '}
                  · {entry.bankName} · {formatMoney(entry.principal, entry.currency)}
                </span>
                <span className="text-[var(--theme-muted)]">
                  {entry.status}{entry.autoRenew ? ' · auto-renew preference' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-2">
        {deposits.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No fixed deposits added yet.
          </p>
        )}
        {deposits.map((fd, index) => {
          const id = stringField(fd, 'id') || String(index)
          const status = stringField(fd, 'status') || 'active'
          const maturity = stringField(fd, 'maturityDate')
          const remaining = daysUntil(maturity)
          const payout = stringField(fd, 'interestPayout').replace('_', ' ')
          const fdCurrency = stringField(fd, 'currency') || 'LKR'
          const estimatedValue = estimatedMaturityValue(
            numberField(fd, 'principal'),
            numberField(fd, 'interestRatePct'),
            stringField(fd, 'startDate'),
            maturity,
          )
          const accruedInterest = estimatedAccruedInterest(
            numberField(fd, 'principal'),
            numberField(fd, 'interestRatePct'),
            stringField(fd, 'startDate'),
            maturity,
          )
          const nextPayout = nextInterestPayoutDate(
            stringField(fd, 'startDate'),
            maturity,
            stringField(fd, 'interestPayout') as InterestPayoutFrequency,
          )
          const fdPayoutAccountId = stringField(fd, 'payoutAccountId')
          const fdAutoRenew = fd.autoRenew === true
          const isEditing = editOpenId === id
          const editDraft = editDrafts[id]
          const payoutAccount = accounts.find(
            (account) => stringField(account, 'id') === fdPayoutAccountId,
          )
          return (
            <div
              key={id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              {isEditing ? (
                <div className="flex w-full flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Bank name"
                    value={editDraft.bankName}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], bankName: event.target.value } }))}
                    className={inputClass}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Principal"
                    value={editDraft.principal}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], principal: event.target.value } }))}
                    className={`${inputClass} w-32`}
                  />
                  <select
                    value={editDraft.currency}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], currency: event.target.value } }))}
                    className={inputClass}
                  >
                    <option value="LKR">LKR</option>
                    <option value="USD">USD</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    placeholder="Interest rate %"
                    value={editDraft.interestRatePct}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], interestRatePct: event.target.value } }))}
                    className={`${inputClass} w-32`}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Interest received"
                    value={editDraft.interestReceived}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], interestReceived: event.target.value } }))}
                    className={`${inputClass} w-32`}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Tax deducted"
                    value={editDraft.taxDeducted}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], taxDeducted: event.target.value } }))}
                    className={`${inputClass} w-32`}
                  />
                  <select
                    value={editDraft.interestPayout}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], interestPayout: event.target.value as InterestPayoutFrequency } }))}
                    className={inputClass}
                  >
                    <option value="monthly">Monthly interest</option>
                    <option value="quarterly">Quarterly interest</option>
                    <option value="annually">Annual interest</option>
                    <option value="at_maturity">All at maturity</option>
                  </select>
                  <input
                    type="date"
                    value={editDraft.startDate}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], startDate: event.target.value } }))}
                    className={inputClass}
                    title="Start date"
                  />
                  <input
                    type="date"
                    value={editDraft.maturityDate}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], maturityDate: event.target.value } }))}
                    className={inputClass}
                    title="Maturity date"
                  />
                  <select
                    value={editDraft.payoutAccountId}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], payoutAccountId: event.target.value } }))}
                    className={inputClass}
                  >
                    <option value="">Payout account (optional)</option>
                    {accounts.map((account) => (
                      <option key={stringField(account, 'id')} value={stringField(account, 'id')}>
                        {stringField(account, 'name') || 'Unnamed account'} · {stringField(account, 'currency') || 'LKR'}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 px-1 text-xs text-[var(--theme-muted)]">
                    <input
                      type="checkbox"
                      checked={editDraft.autoRenew}
                      onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], autoRenew: event.target.checked } }))}
                    />
                    Auto-renew preference
                  </label>
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={editDraft.notes}
                    onChange={(event) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], notes: event.target.value } }))}
                    className={inputClass}
                  />
                  <button type="button" disabled={busy === `edit-fd-${id}`} onClick={() => void saveEdit(id)} className={buttonClass}>
                    {busy === `edit-fd-${id}` ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditOpenId(null)} className={buttonClass}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
              <div>
                <span className="font-medium text-[var(--theme-text)]">
                  {stringField(fd, 'bankName')}
                </span>{' '}
                <span className="text-xs text-[var(--theme-muted)]">
                  · {formatMoney(numberField(fd, 'principal'), fdCurrency)} ·{' '}
                  {numberField(fd, 'interestRatePct')}% p.a. · {payout} ·{' '}
                  {status}
                </span>
                {estimatedValue !== null && (
                  <p className="mt-1 text-xs text-[var(--theme-muted)]">
                    Estimated at maturity: {formatMoney(estimatedValue, fdCurrency)}
                    <span className="ml-1 italic">(simple interest)</span>
                  </p>
                )}
                {accruedInterest !== null && accruedInterest > 0 && (
                  <p className="text-xs text-[var(--theme-muted)]">
                    Accrued interest estimate: {formatMoney(accruedInterest, fdCurrency)}
                  </p>
                )}
                {(numberField(fd, 'interestReceived') > 0 || numberField(fd, 'taxDeducted') > 0) && (
                  <p className="text-xs text-[var(--theme-muted)]">
                    Received: {formatMoney(numberField(fd, 'interestReceived'), fdCurrency)} · Tax deducted:{' '}
                    {formatMoney(numberField(fd, 'taxDeducted'), fdCurrency)} · Net: {formatMoney(
                      Math.max(0, numberField(fd, 'interestReceived') - numberField(fd, 'taxDeducted')),
                      fdCurrency,
                    )}
                  </p>
                )}
                {fdPayoutAccountId && (
                  <p className="text-xs text-[var(--theme-muted)]">
                    Payout account: {payoutAccount ? stringField(payoutAccount, 'name') : 'Account unavailable'}
                  </p>
                )}
                {fdAutoRenew && (
                  <p className="text-xs text-[var(--theme-muted)]">
                    Auto-renew preference: enabled (manual confirmation required)
                  </p>
                )}
                {nextPayout && (
                  <p className="text-xs text-[var(--theme-muted)]">
                    Next interest payout: {formatDateOnly(nextPayout)}
                  </p>
                )}
                {status === 'active' &&
                  remaining !== null &&
                  (() => {
                    const badge = maturityBadge(remaining)
                    return (
                      <span
                        className={`ml-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${badge.tone}`}
                      >
                        {badge.text}
                      </span>
                    )
                  })()}
                {stringField(fd, 'notes') && (
                  <p className="mt-1 text-xs text-[var(--theme-muted)]">
                    {stringField(fd, 'notes')}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(fd)}
                  className={buttonClass}
                >
                  Edit
                </button>
                {status === 'active' && (
                  <>
                    <button
                      type="button"
                      disabled={busy === `mature-${id}`}
                      onClick={() => void markMatured(id)}
                      className={buttonClass}
                    >
                      Mark matured
                    </button>
                    <button
                      type="button"
                      disabled={busy === `withdraw-${id}`}
                      onClick={() => void markWithdrawn(id)}
                      className={buttonClass}
                    >
                      Mark withdrawn
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy === `delete-${id}`}
                  onClick={() => setConfirmDeleteId(id)}
                  className={dangerButtonClass}
                >
                  Delete
                </button>
              </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this fixed deposit?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteFd(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
