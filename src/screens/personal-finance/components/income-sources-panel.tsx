import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr, formatMoney } from '../utils'
import { getPaydayStatus } from './payday-status'
import type { PersonalFinancePayload } from '../types'

const paydayTone: Record<'paid' | 'due_soon' | 'overdue', string> = {
  paid: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
  due_soon: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
  overdue: 'border-red-400/30 bg-red-500/15 text-red-100',
}

export function paydayLabel(job: Record<string, unknown>, incomeRecords: Array<Record<string, unknown>>): { text: string; tone: string } | null {
  const status = getPaydayStatus(job, incomeRecords)
  if (status.state === 'not_tracked') return null
  if (status.state === 'paid') {
    return { text: `Paid ${status.lastPaidDate}`, tone: paydayTone.paid }
  }
  if (status.state === 'overdue') {
    return { text: `Overdue by ${status.daysOverdue}d`, tone: paydayTone.overdue }
  }
  if (status.daysUntil > 3) return { text: `Due in ${status.daysUntil}d`, tone: 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]' }
  if (status.daysUntil >= 0) return { text: status.daysUntil === 0 ? 'Due today' : `Due in ${status.daysUntil}d`, tone: paydayTone.due_soon }
  return { text: `${-status.daysUntil}d past payday`, tone: paydayTone.due_soon }
}

const expiryTone = {
  ok: 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]',
  soon: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
  ended: 'border-red-400/30 bg-red-500/15 text-red-100',
}

export function contractExpiryLabel(job: Record<string, unknown>): { text: string; tone: string } | null {
  if (job.employmentType !== 'contract' || job.status !== 'active') return null
  const contractEndDate = typeof job.contractEndDate === 'string' ? job.contractEndDate : ''
  if (!contractEndDate) return null
  const target = Date.parse(contractEndDate)
  if (!Number.isFinite(target)) return null
  const daysUntil = Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000))
  if (daysUntil < 0) return { text: `Contract ended ${-daysUntil}d ago`, tone: expiryTone.ended }
  if (daysUntil <= 30) return { text: `Contract ends in ${daysUntil}d`, tone: expiryTone.soon }
  return { text: `Contract ends in ${daysUntil}d`, tone: expiryTone.ok }
}

const inputClass =
  'min-w-[140px] rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function numberField(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = row[key]
  return typeof value === 'number' ? value : undefined
}

/** Fuzzy enough to catch "Acme Corp" vs "Acme Corp Pvt Ltd", not so fuzzy it flags unrelated names. */
function findPossibleDuplicateJob(
  jobs: Array<Record<string, unknown>>,
  employerName: string,
): Record<string, unknown> | null {
  const target = employerName.trim().toLowerCase()
  if (!target) return null
  for (const job of jobs) {
    if (stringField(job, 'status') !== 'active') continue
    const existing = stringField(job, 'employerName').trim().toLowerCase()
    if (existing && (existing === target || existing.includes(target) || target.includes(existing))) {
      return job
    }
  }
  return null
}

/**
 * "Jobs" — separate from one-off income entries. Not every job has a fixed
 * monthly amount (freelance/contract income can be irregular), so
 * monthlyIncomeAmount is optional both in the form and the schema.
 */
export function IncomeSourcesPanel({
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
  const [employerName, setEmployerName] = useState('')
  const [employmentType, setEmploymentType] = useState<
    'full_time' | 'contract' | 'freelance' | 'other'
  >('full_time')
  const [monthlyIncomeAmount, setMonthlyIncomeAmount] = useState('')
  const [currency, setCurrency] = useState('LKR')
  const [contractStartDate, setContractStartDate] = useState('')
  const [contractEndDate, setContractEndDate] = useState('')
  const [expectedPaydayDayOfMonth, setExpectedPaydayDayOfMonth] = useState('')
  const [payLogDrafts, setPayLogDrafts] = useState<Record<string, { amount: string; currency: string; date: string }>>({})
  const [payLogOpenId, setPayLogOpenId] = useState<string | null>(null)
  const [duplicateWarningName, setDuplicateWarningName] = useState<string | null>(null)
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null)
  const [reanalyzeNote, setReanalyzeNote] = useState<string | null>(null)

  async function submitJob(force = false) {
    if (!employerName.trim()) {
      setErr('Employer name is required')
      return
    }
    if (!force) {
      const duplicate = findPossibleDuplicateJob(payload.data.income_sources, employerName)
      if (duplicate) {
        setDuplicateWarningName(stringField(duplicate, 'employerName'))
        return
      }
    }
    setDuplicateWarningName(null)
    const data = await post(
      {
        action: 'add_record',
        kind: 'income_source',
        payload: {
          employerName: employerName.trim(),
          employmentType,
          monthlyIncomeAmount: monthlyIncomeAmount.trim()
            ? Number(monthlyIncomeAmount)
            : undefined,
          currency,
          contractStartDate: contractStartDate || undefined,
          contractEndDate: contractEndDate || undefined,
          expectedPaydayDayOfMonth: expectedPaydayDayOfMonth.trim()
            ? Number(expectedPaydayDayOfMonth)
            : undefined,
        },
      },
      'job',
    )
    if (data) {
      setEmployerName('')
      setMonthlyIncomeAmount('')
      setContractStartDate('')
      setContractEndDate('')
      setExpectedPaydayDayOfMonth('')
    }
  }

  async function logPayment(job: Record<string, unknown>) {
    const jobId = stringField(job, 'id')
    const draft = payLogDrafts[jobId]
    const amount = Number(draft.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr('Enter a valid amount for this payment')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'income',
        payload: {
          dateReceived: draft.date,
          sourceName: stringField(job, 'employerName'),
          incomeType: 'Salary',
          originalCurrency: draft.currency,
          originalAmount: amount,
          incomeSourceId: jobId,
        },
      },
      `log-payment-${jobId}`,
    )
    if (data) setPayLogOpenId(null)
  }

  async function endJob(id: string) {
    await post(
      {
        action: 'update_record',
        kind: 'income_source',
        id,
        payload: { status: 'ended' },
      },
      `end-${id}`,
    )
  }

  async function deleteJob(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'income_source', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  // Raw fetch, not useFinanceAction — the response is {ok, pendingIngestionId},
  // not a full PersonalFinancePayload, so it must not be passed to onPayload.
  async function reanalyzeContract(id: string) {
    setReanalyzingId(id)
    setReanalyzeNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reanalyze_contract', incomeSourceId: id }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      setReanalyzeNote(
        data.ok === false
          ? data.error || 'Re-analysis failed'
          : 'Re-analysis complete — check the Ingestion tab to review it.',
      )
    } catch (e) {
      setReanalyzeNote(e instanceof Error ? e.message : 'Re-analysis failed')
    } finally {
      setReanalyzingId(null)
    }
  }

  const jobs = payload.data.income_sources

  // Grouped by currency rather than converted to one figure — the codebase's
  // only FX handling is a manually-entered per-record rate on one-off income
  // entries, not a general converter, so summing across currencies here
  // would silently invent a conversion this app doesn't otherwise do.
  const activeMonthlyTotals = new Map<string, number>()
  for (const job of jobs) {
    if (stringField(job, 'status') !== 'active') continue
    const amount = numberField(job, 'monthlyIncomeAmount')
    if (amount === undefined) continue
    const jobCurrency = stringField(job, 'currency') || 'LKR'
    activeMonthlyTotals.set(
      jobCurrency,
      (activeMonthlyTotals.get(jobCurrency) ?? 0) + amount,
    )
  }
  const activeMonthlyTotalText = Array.from(activeMonthlyTotals.entries())
    .map(([entryCurrency, amount]) => formatMoney(amount, entryCurrency))
    .join(' · ')

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Jobs / income sources</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Track where your income comes from — full-time, contract (with a term),
        or freelance/irregular. A monthly amount is optional; leave it blank for
        income that varies.
      </p>
      {activeMonthlyTotalText && (
        <p className="mt-2 text-sm font-medium text-[var(--theme-text)]">
          Active monthly income:{' '}
          <span className="text-emerald-300">{activeMonthlyTotalText}</span>/mo
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Employer / client name"
          value={employerName}
          onChange={(e) => setEmployerName(e.target.value)}
          className={inputClass}
        />
        <select
          value={employmentType}
          onChange={(e) =>
            setEmploymentType(e.target.value as typeof employmentType)
          }
          className={inputClass}
        >
          <option value="full_time">Full-time</option>
          <option value="contract">Contract</option>
          <option value="freelance">Freelance</option>
          <option value="other">Other</option>
        </select>
        <input
          type="number"
          placeholder="Monthly amount (optional)"
          value={monthlyIncomeAmount}
          onChange={(e) => setMonthlyIncomeAmount(e.target.value)}
          className={`${inputClass} w-40`}
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className={inputClass}
        >
          <option value="LKR">LKR</option>
          <option value="USD">USD</option>
          <option value="AUD">AUD</option>
        </select>
        <input
          type="number"
          min={1}
          max={31}
          placeholder="Payday (day, optional)"
          value={expectedPaydayDayOfMonth}
          onChange={(e) => setExpectedPaydayDayOfMonth(e.target.value)}
          className={`${inputClass} w-36`}
          title="Expected day of month you get paid, e.g. 30"
        />
        {employmentType === 'contract' && (
          <>
            <input
              type="date"
              value={contractStartDate}
              onChange={(e) => setContractStartDate(e.target.value)}
              className={inputClass}
              title="Contract start date"
            />
            <input
              type="date"
              value={contractEndDate}
              onChange={(e) => setContractEndDate(e.target.value)}
              className={inputClass}
              title="Contract end date"
            />
          </>
        )}
        <button
          type="button"
          disabled={busy === 'job'}
          onClick={() => void submitJob(false)}
          className={buttonClass}
        >
          {busy === 'job' ? 'Saving…' : 'Add job'}
        </button>
      </div>

      {duplicateWarningName && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-2">
          <p className="text-xs text-amber-100">
            A job for "{duplicateWarningName}" already exists — add this one anyway?
          </p>
          <button
            type="button"
            disabled={busy === 'job'}
            onClick={() => void submitJob(true)}
            className="rounded-xl border border-amber-400/40 bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
          >
            Add anyway
          </button>
          <button type="button" onClick={() => setDuplicateWarningName(null)} className={buttonClass}>
            Cancel
          </button>
        </div>
      )}

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
      {reanalyzeNote && <p className="mt-2 text-xs text-[var(--theme-muted)]">{reanalyzeNote}</p>}

      <div className="mt-4 grid gap-2">
        {jobs.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No jobs added yet.
          </p>
        )}
        {jobs.map((job, index) => {
          const id = stringField(job, 'id') || String(index)
          const monthly = numberField(job, 'monthlyIncomeAmount')
          const status = stringField(job, 'status') || 'active'
          const notes = stringField(job, 'notes')
          const documentRef = stringField(job, 'documentRef')
          const paydayStatus = getPaydayStatus(job, payload.data.income_records)
          const badge = paydayLabel(job, payload.data.income_records)
          const expiryBadge = contractExpiryLabel(job)
          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-[var(--theme-text)]">
                    {stringField(job, 'employerName')}
                  </span>{' '}
                  <span className="text-xs text-[var(--theme-muted)]">
                    · {stringField(job, 'employmentType').replace('_', ' ')} ·{' '}
                    {monthly !== undefined
                      ? `${formatLkr(monthly)}/mo`
                      : 'irregular income'}{' '}
                    · {status}
                  </span>
                  {badge && (
                    <span className={`ml-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${badge.tone}`}>
                      {badge.text}
                    </span>
                  )}
                  {expiryBadge && (
                    <span className={`ml-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${expiryBadge.tone}`}>
                      {expiryBadge.text}
                    </span>
                  )}
                  {stringField(job, 'paySchedule') && (
                    <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                      Pay schedule (from contract): {stringField(job, 'paySchedule')}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {documentRef && (
                    <>
                      <a
                        href={`/api/finance-document?kind=income_source&id=${id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass}
                      >
                        View original contract
                      </a>
                      <button
                        type="button"
                        disabled={reanalyzingId === id}
                        onClick={() => void reanalyzeContract(id)}
                        className={buttonClass}
                      >
                        {reanalyzingId === id ? 'Re-analyzing…' : 'Re-analyze contract'}
                      </button>
                    </>
                  )}
                  {status === 'active' &&
                    monthly !== undefined &&
                    paydayStatus.state !== 'not_tracked' &&
                    paydayStatus.state !== 'paid' && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayLogOpenId(id)
                          setPayLogDrafts((prev) => ({
                            ...prev,
                            [id]: prev[id] ?? {
                              amount: String(monthly),
                              currency: stringField(job, 'currency') || 'LKR',
                              date: new Date().toISOString().slice(0, 10),
                            },
                          }))
                        }}
                        className={buttonClass}
                      >
                        Log this month's payment
                      </button>
                    )}
                  {status === 'active' && (
                    <button
                      type="button"
                      disabled={busy === `end-${id}`}
                      onClick={() => void endJob(id)}
                      className={buttonClass}
                    >
                      Mark ended
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === `delete-${id}`}
                    onClick={() => setConfirmDeleteId(id)}
                    className="rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {payLogOpenId === id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--theme-border)]/60 bg-black/20 p-2">
                  <input
                    type="number"
                    placeholder="Amount"
                    value={payLogDrafts[id].amount}
                    onChange={(e) =>
                      setPayLogDrafts((prev) => ({ ...prev, [id]: { ...prev[id], amount: e.target.value } }))
                    }
                    className={`${inputClass} w-28`}
                  />
                  <input
                    type="text"
                    placeholder="Currency"
                    value={payLogDrafts[id].currency}
                    onChange={(e) =>
                      setPayLogDrafts((prev) => ({ ...prev, [id]: { ...prev[id], currency: e.target.value } }))
                    }
                    className={`${inputClass} w-20`}
                  />
                  <input
                    type="date"
                    value={payLogDrafts[id].date}
                    onChange={(e) =>
                      setPayLogDrafts((prev) => ({ ...prev, [id]: { ...prev[id], date: e.target.value } }))
                    }
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={busy === `log-payment-${id}`}
                    onClick={() => void logPayment(job)}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {busy === `log-payment-${id}` ? 'Saving…' : 'Confirm payment'}
                  </button>
                  <button type="button" onClick={() => setPayLogOpenId(null)} className={buttonClass}>
                    Cancel
                  </button>
                </div>
              )}
              {notes && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-[var(--theme-muted)]">
                    Notes / AI contract review
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--theme-muted)]">
                    {notes}
                  </p>
                </details>
              )}
            </div>
          )
        })}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this job/income source?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteJob(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
