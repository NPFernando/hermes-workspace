import { useMemo } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatDateOnly, formatMoney } from '../utils'
import { buttonClass, warningTone } from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

const STALE_AFTER_DAYS = 7

export function getReconciliationIssues(
  transactions: Array<Record<string, unknown>>,
  now = new Date(),
): Array<Record<string, unknown>> {
  const cutoff = now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
  return transactions
    .filter((transaction) => {
      if (stringField(transaction, 'status') !== 'pending') return false
      const date = Date.parse(stringField(transaction, 'date'))
      return Number.isFinite(date) && date <= cutoff
    })
    .sort((left, right) => {
      const leftDate = Date.parse(stringField(left, 'date'))
      const rightDate = Date.parse(stringField(right, 'date'))
      return leftDate - rightDate
    })
}

export function ReconciliationIssuesPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const issues = useMemo(() => getReconciliationIssues(payload.transactions), [payload.transactions])

  async function markCleared(transaction: Record<string, unknown>) {
    const id = stringField(transaction, 'id')
    const kind = stringField(transaction, 'kind')
    if (!id || (kind !== 'income' && kind !== 'expense')) return
    await post(
      {
        action: 'update_record',
        kind,
        id,
        payload: { status: 'cleared' },
      },
      `reconciliation-${id}`,
    )
  }

  return (
    <section className="mb-5 rounded-3xl border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Reconciliation issues</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Pending transactions older than {STALE_AFTER_DAYS} days may need a statement check.
          </p>
        </div>
        <span className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${warningTone}`}>
          {issues.length} needs review
        </span>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
      {issues.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          No stale pending transactions need reconciliation.
        </p>
      ) : (
        <div className="mt-3 grid gap-2">
          {issues.map((transaction, index) => {
            const id = stringField(transaction, 'id') || String(index)
            const currency = stringField(transaction, 'currency') || 'LKR'
            const kind = stringField(transaction, 'kind')
            return (
              <div
                key={id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--theme-border)]/70 bg-[var(--theme-panel)]/60 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {stringField(transaction, 'counterparty') || 'Unlabelled transaction'} ·{' '}
                    {formatMoney(numberField(transaction, 'amount'), currency)}
                  </p>
                  <p className="text-xs text-[var(--theme-muted)]">
                    {formatDateOnly(stringField(transaction, 'date'))} · {kind || 'transaction'} · pending
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy === `reconciliation-${id}`}
                  onClick={() => void markCleared(transaction)}
                >
                  {busy === `reconciliation-${id}` ? 'Saving…' : 'Mark cleared'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
