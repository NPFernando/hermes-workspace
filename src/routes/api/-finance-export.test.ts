import { describe, expect, it } from 'vitest'
import { createEmptyFinanceDatabase } from '../../server/finance-store'
import { reportHtml, transactionsCsv } from './finance-export'

/**
 * Review finding U7: the export was JSON-only. `?format=csv` and
 * `?format=report` add a spreadsheet + a printable summary. These pin the
 * two pure builders.
 */
function seededDb() {
  const db = createEmptyFinanceDatabase()
  db.finance_accounts.push(
    { id: 'acc-a', name: 'Everyday, "checking"', currency: 'LKR', type: 'bank', balance: 0, source: 'test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'acc-b', name: 'Savings', currency: 'LKR', type: 'bank', balance: 0, source: 'test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  )
  db.income_records.push({
    id: 'i-1',
    dateReceived: '2026-06-01',
    sourceName: 'Salary',
    incomeType: 'Salary',
    originalCurrency: 'LKR',
    originalAmount: 300_000,
    exchangeRateUsed: 1,
    convertedLkrAmount: 300_000,
    accountId: 'acc-a',
    taxable: true,
    source: 'test',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  })
  db.expense_records.push({
    id: 'e-1',
    date: '2026-06-05',
    vendor: 'Cargills',
    category: 'Groceries',
    currency: 'LKR',
    amount: 8_500,
    convertedLkrAmount: 8_500,
    recurring: false,
    workRelated: false,
    taxDeductiblePossible: false,
    notes: 'weekly, big shop',
    source: 'test',
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  })
  db.transfers.push({
    id: 't-1',
    date: '2026-06-08',
    fromAccountId: 'acc-a',
    toAccountId: 'acc-b',
    amount: 50_000,
    currency: 'LKR',
    convertedLkrAmount: 50_000,
    source: 'test',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
  })
  return db
}

describe('transactionsCsv', () => {
  it('emits a header + one row per unified transaction, newest first', () => {
    const csv = transactionsCsv(seededDb())
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      'date,kind,counterparty,category,subcategory,account,to_account,currency,amount,amount_lkr,status,tags,notes,source',
    )
    expect(lines).toHaveLength(4)
    // sorted by date desc: transfer (06-08), expense (06-05), income (06-01)
    expect(lines[1]).toContain('2026-06-08,transfer')
    expect(lines[3]).toContain('2026-06-01,income')
  })

  it('resolves account ids to names and fills to_account only for transfers', () => {
    const rows = transactionsCsv(seededDb()).trimEnd().split('\r\n')
    const transferRow = rows.find((r) => r.includes(',transfer,'))!
    // account name has a comma + quotes → must be CSV-quoted
    expect(transferRow).toContain('"Everyday, ""checking""",Savings,')
    const incomeRow = rows.find((r) => r.includes(',income,'))!
    // income row: account filled, to_account empty
    expect(incomeRow).toMatch(/,"Everyday, ""checking""",,LKR,300000,300000,/)
  })

  it('quotes fields that contain commas', () => {
    const csv = transactionsCsv(seededDb())
    expect(csv).toContain('"weekly, big shop"')
  })

  it('returns just the header for an empty db', () => {
    const csv = transactionsCsv(createEmptyFinanceDatabase())
    expect(csv.trimEnd().split('\r\n')).toHaveLength(1)
  })
})

describe('reportHtml', () => {
  it('is a full HTML doc with the summary stats and a transactions table', () => {
    const html = reportHtml(seededDb())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Personal finance summary')
    expect(html).toContain('Net worth')
    expect(html).toContain('Print → Save as PDF')
    expect(html).toContain('<td>Cargills</td>')
    expect(html).toContain('LKR 300,000')
  })

  it('escapes HTML-significant characters in record fields', () => {
    const db = createEmptyFinanceDatabase()
    db.expense_records.push({
      id: 'e-x',
      date: '2026-06-05',
      vendor: '<script>alert(1)</script>',
      category: 'Misc',
      currency: 'LKR',
      amount: 100,
      convertedLkrAmount: 100,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    })
    const html = reportHtml(db)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
