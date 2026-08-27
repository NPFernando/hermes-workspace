import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr } from '../utils'
import type { PersonalFinancePayload } from '../types'

const inputClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function numberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' ? value : undefined
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
  const { run: post, busy, error: err, setError: setErr } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [employerName, setEmployerName] = useState('')
  const [employmentType, setEmploymentType] = useState<'full_time' | 'contract' | 'freelance' | 'other'>('full_time')
  const [monthlyIncomeAmount, setMonthlyIncomeAmount] = useState('')
  const [currency, setCurrency] = useState('LKR')
  const [contractStartDate, setContractStartDate] = useState('')
  const [contractEndDate, setContractEndDate] = useState('')

  async function submitJob() {
    if (!employerName.trim()) {
      setErr('Employer name is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'income_source',
        payload: {
          employerName: employerName.trim(),
          employmentType,
          monthlyIncomeAmount: monthlyIncomeAmount.trim() ? Number(monthlyIncomeAmount) : undefined,
          currency,
          contractStartDate: contractStartDate || undefined,
          contractEndDate: contractEndDate || undefined,
        },
      },
      'job',
    )
    if (data) {
      setEmployerName('')
      setMonthlyIncomeAmount('')
      setContractStartDate('')
      setContractEndDate('')
    }
  }

  async function endJob(id: string) {
    await post({ action: 'update_record', kind: 'income_source', id, payload: { status: 'ended' } }, `end-${id}`)
  }

  async function deleteJob(id: string) {
    const data = await post({ action: 'delete_record', kind: 'income_source', id }, `delete-${id}`)
    if (data) setConfirmDeleteId(null)
  }

  const jobs = payload.data.income_sources

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Jobs / income sources</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Track where your income comes from — full-time, contract (with a term), or freelance/irregular. A monthly
        amount is optional; leave it blank for income that varies.
      </p>

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
          onChange={(e) => setEmploymentType(e.target.value as typeof employmentType)}
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
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
          <option value="LKR">LKR</option>
          <option value="USD">USD</option>
          <option value="AUD">AUD</option>
        </select>
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
        <button type="button" disabled={busy === 'job'} onClick={() => void submitJob()} className={buttonClass}>
          {busy === 'job' ? 'Saving…' : 'Add job'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {jobs.length === 0 && <p className="text-sm text-[var(--theme-muted)]">No jobs added yet.</p>}
        {jobs.map((job, index) => {
          const id = stringField(job, 'id') || String(index)
          const monthly = numberField(job, 'monthlyIncomeAmount')
          const status = stringField(job, 'status') || 'active'
          return (
            <div
              key={id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
            >
              <div>
                <span className="font-medium text-[var(--theme-text)]">{stringField(job, 'employerName')}</span>{' '}
                <span className="text-xs text-[var(--theme-muted)]">
                  · {stringField(job, 'employmentType').replace('_', ' ')} ·{' '}
                  {monthly !== undefined ? `${formatLkr(monthly)}/mo` : 'irregular income'} · {status}
                </span>
              </div>
              <div className="flex gap-2">
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
