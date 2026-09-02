import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatMoney } from '../utils'
import type { PersonalFinancePayload } from '../types'

const inputClass =
  'min-w-[140px] rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function daysUntil(dateStr: string): number | null {
  const target = Date.parse(dateStr)
  if (!Number.isFinite(target)) return null
  return Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000))
}

const maturityTone = {
  ok: 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]',
  soon: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
  overdue: 'border-red-400/30 bg-red-500/15 text-red-100',
}

export function maturityBadge(remaining: number): { text: string; tone: string } {
  if (remaining >= 0) {
    const text = `Matures in ${remaining}d`
    return { text, tone: remaining <= 30 ? maturityTone.soon : maturityTone.ok }
  }
  const overdue = Math.abs(remaining)
  const text = `Matured ${overdue}d ago`
  return { text, tone: overdue <= 7 ? maturityTone.soon : maturityTone.overdue }
}

export function FixedDepositsPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error: err, setError: setErr } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [bankName, setBankName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [currency, setCurrency] = useState('LKR')
  const [interestRatePct, setInterestRatePct] = useState('')
  const [interestPayout, setInterestPayout] = useState<'monthly' | 'quarterly' | 'annually' | 'at_maturity'>('at_maturity')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
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
      setMaturityDate('')
      setNotes('')
    }
  }

  async function markMatured(id: string) {
    await post({ action: 'update_record', kind: 'fixed_deposit', id, payload: { status: 'matured' } }, `mature-${id}`)
  }

  async function markWithdrawn(id: string) {
    await post({ action: 'update_record', kind: 'fixed_deposit', id, payload: { status: 'withdrawn' } }, `withdraw-${id}`)
  }

  async function deleteFd(id: string) {
    const data = await post({ action: 'delete_record', kind: 'fixed_deposit', id }, `delete-${id}`)
    if (data) setConfirmDeleteId(null)
  }

  const deposits = payload.data.fixed_deposits

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Fixed deposits</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Track principal, the annual interest rate, and when interest pays out — monthly, quarterly, annually, or all
        at maturity.
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
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
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
        <select
          value={interestPayout}
          onChange={(e) => setInterestPayout(e.target.value as typeof interestPayout)}
          className={inputClass}
        >
          <option value="monthly">Monthly interest</option>
          <option value="quarterly">Quarterly interest</option>
          <option value="annually">Annual interest</option>
          <option value="at_maturity">All at maturity</option>
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} title="Start date" />
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
        <button type="button" disabled={busy === 'fd'} onClick={() => void submitFd()} className={buttonClass}>
          {busy === 'fd' ? 'Saving…' : 'Add fixed deposit'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {deposits.length === 0 && <p className="text-sm text-[var(--theme-muted)]">No fixed deposits added yet.</p>}
        {deposits.map((fd, index) => {
          const id = stringField(fd, 'id') || String(index)
          const status = stringField(fd, 'status') || 'active'
          const maturity = stringField(fd, 'maturityDate')
          const remaining = daysUntil(maturity)
          const payout = stringField(fd, 'interestPayout').replace('_', ' ')
          const fdCurrency = stringField(fd, 'currency') || 'LKR'
          return (
            <div
              key={id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
            >
              <div>
                <span className="font-medium text-[var(--theme-text)]">{stringField(fd, 'bankName')}</span>{' '}
                <span className="text-xs text-[var(--theme-muted)]">
                  · {formatMoney(numberField(fd, 'principal'), fdCurrency)} · {numberField(fd, 'interestRatePct')}% p.a. ·{' '}
                  {payout} ·{' '}
                  {status}
                </span>
                {status === 'active' &&
                  remaining !== null &&
                  (() => {
                    const badge = maturityBadge(remaining)
                    return (
                      <span className={`ml-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${badge.tone}`}>
                        {badge.text}
                      </span>
                    )
                  })()}
                {stringField(fd, 'notes') && (
                  <p className="mt-1 text-xs text-[var(--theme-muted)]">{stringField(fd, 'notes')}</p>
                )}
              </div>
              <div className="flex gap-2">
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
