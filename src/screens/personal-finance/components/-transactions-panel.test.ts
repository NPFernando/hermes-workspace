import { describe, expect, it } from 'vitest'
import {
  createEmptyFinanceDatabase,
  getUnifiedTransactions,
} from '../../../server/finance-store'
import { unifyTransactions } from './transactions-panel'

/**
 * PF review D1: the payload dropped its pre-unified `transactions` array;
 * TransactionsPanel now derives it client-side from `data.income_records` +
 * `data.expense_records`. This pins the client mapper to the server's
 * `getUnifiedTransactions` shape so the two never drift.
 */
describe('unifyTransactions (client) matches getUnifiedTransactions (server)', () => {
  it('produces the same rows, fields and order from the raw arrays', () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push(
      {
        id: 'i-1',
        dateReceived: '2026-06-10',
        sourceName: 'Salary',
        incomeType: 'Salary',
        originalCurrency: 'LKR',
        originalAmount: 300_000,
        exchangeRateUsed: 1,
        convertedLkrAmount: 300_000,
        taxable: true,
        tags: 'work',
        source: 'test',
        createdAt: '2026-06-10T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:00.000Z',
      },
      {
        id: 'i-2',
        dateReceived: '2026-06-01',
        sourceName: 'Interest',
        incomeType: 'Interest',
        originalCurrency: 'LKR',
        originalAmount: 1_200,
        exchangeRateUsed: 1,
        convertedLkrAmount: 1_200,
        taxable: true,
        source: 'test',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    )
    db.expense_records.push({
      id: 'e-1',
      date: '2026-06-10',
      vendor: 'Cargills',
      category: 'Groceries',
      currency: 'LKR',
      amount: 8_500,
      convertedLkrAmount: 8_500,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      subcategory: 'Food',
      tags: '',
      source: 'test',
      createdAt: '2026-06-10T09:00:00.000Z',
      updatedAt: '2026-06-10T09:00:00.000Z',
    })
    db.transfers.push({
      id: 't-1',
      date: '2026-06-08',
      fromAccountId: 'acc-a',
      toAccountId: 'acc-b',
      amount: 20_000,
      currency: 'LKR',
      convertedLkrAmount: 20_000,
      source: 'test',
      createdAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:00:00.000Z',
    })

    const server = getUnifiedTransactions(db)
    const client = unifyTransactions(
      db.income_records,
      db.expense_records,
      db.transfers,
    )

    expect(client).toEqual(server)
    expect(server.find((r) => r.id === 't-1')).toMatchObject({
      kind: 'transfer',
      counterparty: 'acc-a → acc-b',
      category: 'Transfer',
    })
  })

  it('returns [] for empty inputs', () => {
    expect(unifyTransactions([], [])).toEqual([])
  })
})
