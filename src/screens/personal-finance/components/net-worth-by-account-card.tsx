import { boolField, numberField, stringField } from '../field-helpers'
import { formatMoney } from '../utils'
import type { PersonalFinancePayload } from '../types'

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank: 'Bank',
  cash: 'Cash',
  card: 'Card',
  crypto_wallet: 'Crypto wallet',
  broker: 'Broker',
  foreign_currency: 'Foreign currency',
  loan: 'Loan',
  other: 'Other',
}

export type AccountRow = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
}

export type TypeGroup = {
  type: string
  label: string
  accounts: Array<AccountRow>
  /** Subtotals per currency within this type — mixed-currency accounts under one type are never summed into a single figure. */
  totalsByCurrency: Array<{ currency: string; total: number }>
}

/**
 * Drills the net-worth chart's cash/investments/debt split down to which
 * *account* holds what — the chart already aggregates across accounts,
 * this shows the accounts themselves. `effectiveBalance` mirrors
 * effectiveAccountBalance() in finance-store.ts: the ledger-derived figure
 * when the account opted in and a ledgerBalance was computable, the
 * manually-maintained balance otherwise. Never converts currencies — an
 * account's own currency stays its own; grouping only ever sums within
 * the same (type, currency) pair.
 */
export function groupAccountsByType(
  accounts: Array<Record<string, unknown>>,
): Array<TypeGroup> {
  const rows: Array<AccountRow> = accounts.map((a) => {
    const balance = numberField(a, 'balance')
    const ledgerBalanceRaw = a.ledgerBalance
    const ledgerBalance =
      typeof ledgerBalanceRaw === 'number' ? ledgerBalanceRaw : null
    const deriveFromLedger = boolField(a, 'deriveBalanceFromLedger')
    return {
      id: stringField(a, 'id'),
      name: stringField(a, 'name'),
      type: stringField(a, 'type') || 'other',
      currency: stringField(a, 'currency') || 'LKR',
      balance:
        deriveFromLedger && ledgerBalance !== null ? ledgerBalance : balance,
    }
  })

  const byType = new Map<string, Array<AccountRow>>()
  for (const row of rows) {
    const list = byType.get(row.type) ?? []
    list.push(row)
    byType.set(row.type, list)
  }

  return [...byType.entries()]
    .map(([type, typeAccounts]) => {
      const byCurrency = new Map<string, number>()
      for (const a of typeAccounts) {
        byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + a.balance)
      }
      return {
        type,
        label: ACCOUNT_TYPE_LABELS[type] ?? type,
        accounts: [...typeAccounts].sort((a, b) => b.balance - a.balance),
        totalsByCurrency: [...byCurrency.entries()]
          .map(([currency, total]) => ({ currency, total }))
          .sort((a, b) => b.total - a.total),
      }
    })
    .sort(
      (a, b) =>
        b.totalsByCurrency.reduce((s, t) => s + t.total, 0) -
        a.totalsByCurrency.reduce((s, t) => s + t.total, 0),
    )
}

export function NetWorthByAccountCard({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  const groups = groupAccountsByType(payload.data.finance_accounts)
  if (groups.length === 0) return null

  return (
    <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
      <h3 className="text-sm font-medium text-[var(--theme-text)]">
        Net worth by account
      </h3>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Which account holds what — the chart above sums across accounts,
        this drills into each one.
      </p>
      <div className="mt-3 grid gap-3">
        {groups.map((group) => (
          <div key={group.type}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--theme-muted)]">
                {group.label}
              </p>
              <p className="text-xs text-[var(--theme-muted)]">
                {group.totalsByCurrency
                  .map((t) => formatMoney(t.total, t.currency))
                  .join(' · ')}
              </p>
            </div>
            <div className="mt-1 grid gap-1">
              {group.accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-[var(--theme-text)]">{a.name}</span>
                  <span className="text-[var(--theme-muted)]">
                    {formatMoney(a.balance, a.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
