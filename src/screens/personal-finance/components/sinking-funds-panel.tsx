import { useState } from 'react'
import { formatLkr } from '../utils'
import { numberField, stringField, toneFor } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

/**
 * PF-1004: purely informational link to an account — the linked account's
 * balance is manually-maintained today (no transaction-ledger derivation,
 * that's PF-104), so linking does not change how currentAmount is tracked.
 */
function LinkedAccountControl({
  goal,
  payload,
  onPayload,
  editingId,
  setEditingId,
}: {
  goal: Record<string, unknown>
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
  editingId: string | null
  setEditingId: (id: string | null) => void
}) {
  const id = stringField(goal, 'id')
  const linkedAccountId = stringField(goal, 'linkedAccountId')
  const accounts = payload.data.finance_accounts
  const linkedAccount = accounts.find(
    (a) => stringField(a, 'id') === linkedAccountId,
  )

  async function setLinkedAccount(nextId: string) {
    setEditingId(null)
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'update_record',
        kind: 'goal',
        id,
        payload: { linkedAccountId: nextId || null },
      }),
    })
      .then((r) => r.json())
      .then((data: PersonalFinancePayload) => {
        if (data.ok) onPayload(data)
      })
      .catch(() => {})
  }

  if (linkedAccountId && editingId !== id) {
    return (
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        🔗 Linked to{' '}
        {linkedAccount
          ? stringField(linkedAccount, 'name')
          : '(removed account)'}{' '}
        <button
          type="button"
          onClick={() => setEditingId(id)}
          className="underline hover:text-[var(--theme-text)]"
        >
          Change
        </button>
      </p>
    )
  }

  return (
    <select
      value={linkedAccountId}
      onChange={(e) => void setLinkedAccount(e.target.value)}
      className="mt-1 rounded-lg border border-[var(--theme-border)] bg-black/10 px-2 py-0.5 text-xs text-[var(--theme-text)] outline-none"
    >
      <option value="">— No linked account —</option>
      {accounts.map((account, index) => {
        const accountId = stringField(account, 'id') || String(index)
        return (
          <option key={accountId} value={accountId}>
            {stringField(account, 'name')}
          </option>
        )
      })}
    </select>
  )
}

/**
 * PF-1007/1008: sinking funds are savings goals earmarked for a specific
 * planned future expense (goalKind: 'sinking'), distinct from open-ended
 * goals shown in SavingsGoalsProgress. The "schedule" here is computed on
 * the fly (required LKR/mo vs. the stored monthlyContribution) rather than
 * a persisted table of dated installments — see roadmap Shipped note.
 */
export function SinkingFundsPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const funds = payload.data.savings_goals.filter(
    (row) => stringField(row, 'goalKind') === 'sinking',
  )
  if (funds.length === 0) return null

  const sorted = [...funds].sort(
    (a, b) => numberField(a, 'priority') - numberField(b, 'priority'),
  )

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">
        Sinking funds
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {sorted.map((fund, index) => {
          const target = numberField(fund, 'targetAmount')
          const current = numberField(fund, 'currentAmount')
          const monthlyContribution = numberField(fund, 'monthlyContribution')
          const percent =
            target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
          const tone = toneFor(percent)
          const name = stringField(fund, 'name') || 'Sinking fund'
          const targetDate = stringField(fund, 'targetDate')
          const remaining = target - current

          let scheduleLine: { text: string; tone: string } | null = null
          if (remaining <= 0) {
            scheduleLine = { text: 'Fully funded', tone: 'text-emerald-300' }
          } else if (targetDate) {
            const daysUntil = Math.ceil(
              (Date.parse(targetDate) - Date.now()) / (24 * 60 * 60 * 1000),
            )
            if (Number.isFinite(daysUntil)) {
              if (daysUntil <= 0) {
                scheduleLine = {
                  text: 'Target date passed',
                  tone: 'text-red-300',
                }
              } else {
                const monthsUntil = Math.max(1, Math.ceil(daysUntil / 30))
                const requiredMonthlyLkr = remaining / monthsUntil
                const onTrack = monthlyContribution >= requiredMonthlyLkr
                scheduleLine = {
                  text: `Needs ${formatLkr(requiredMonthlyLkr)}/mo by ${targetDate} — contributing ${formatLkr(monthlyContribution)}/mo`,
                  tone: onTrack ? 'text-emerald-300' : 'text-amber-300',
                }
              }
            }
          } else {
            scheduleLine = {
              text: 'No target date set',
              tone: 'text-[var(--theme-muted)]',
            }
          }

          return (
            <div
              key={String(fund.id ?? index)}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--theme-text)]">
                  {name}
                </span>
                <span className={tone.text}>{percent}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/20">
                <div
                  className={`h-full rounded-full ${tone.bar}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                {formatLkr(current)} / {formatLkr(target)}
              </p>
              {scheduleLine && (
                <p className={`mt-1 text-xs ${scheduleLine.tone}`}>
                  {scheduleLine.text}
                </p>
              )}
              <LinkedAccountControl
                goal={fund}
                payload={payload}
                onPayload={onPayload}
                editingId={editingId}
                setEditingId={setEditingId}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
