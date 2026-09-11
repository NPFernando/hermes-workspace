import { describe, expect, it } from 'vitest'
import { autoDetect, normalizeKind, normalizeRow, parseCsv } from './csv-import-panel'

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    const { headers, rows } = parseCsv(
      'date,amount,vendor\n2026-01-01,100,Keells\n2026-01-02,-50,Cargills\n',
    )
    expect(headers).toEqual(['date', 'amount', 'vendor'])
    expect(rows).toEqual([
      ['2026-01-01', '100', 'Keells'],
      ['2026-01-02', '-50', 'Cargills'],
    ])
  })

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const { headers, rows } = parseCsv(
      'date,vendor,notes\n2026-01-01,"Keells, Nugegoda","He said ""hi"""\n',
    )
    expect(headers).toEqual(['date', 'vendor', 'notes'])
    expect(rows).toEqual([
      ['2026-01-01', 'Keells, Nugegoda', 'He said "hi"'],
    ])
  })

  it('handles CRLF line endings', () => {
    const { rows } = parseCsv('date,amount\r\n2026-01-01,100\r\n')
    expect(rows).toEqual([['2026-01-01', '100']])
  })

  it('drops blank lines', () => {
    const { rows } = parseCsv('date,amount\n2026-01-01,100\n\n2026-01-02,200\n')
    expect(rows).toHaveLength(2)
  })

  it('returns empty headers/rows for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })
})

describe('autoDetect', () => {
  it("matches this app's own export header exactly", () => {
    const mapping = autoDetect([
      'date',
      'kind',
      'counterparty',
      'category',
      'subcategory',
      'account',
      'to_account',
      'currency',
      'amount',
      'amount_lkr',
      'status',
      'tags',
      'notes',
      'source',
    ])
    expect(mapping).toEqual({
      date: 'date',
      amount: 'amount',
      vendor: 'counterparty',
      category: 'category',
      currency: 'currency',
      kindColumn: 'kind',
    })
  })

  it('matches common bank-statement header variants case-insensitively', () => {
    const mapping = autoDetect(['Transaction Date', 'Description', 'Amount'])
    expect(mapping.date).toBe('Transaction Date')
    expect(mapping.vendor).toBe('Description')
    expect(mapping.amount).toBe('Amount')
  })

  it('leaves a field unmapped when nothing matches', () => {
    const mapping = autoDetect(['col1', 'col2'])
    expect(mapping).toEqual({
      date: '',
      amount: '',
      vendor: '',
      category: '',
      currency: '',
      kindColumn: '',
    })
  })
})

describe('normalizeKind', () => {
  it('recognizes income synonyms', () => {
    expect(normalizeKind('Income')).toBe('income')
    expect(normalizeKind('credit')).toBe('income')
    expect(normalizeKind('Deposit')).toBe('income')
  })

  it('recognizes expense synonyms', () => {
    expect(normalizeKind('Expense')).toBe('expense')
    expect(normalizeKind('debit')).toBe('expense')
    expect(normalizeKind('Withdrawal')).toBe('expense')
  })

  it('returns null for an unrecognized value', () => {
    expect(normalizeKind('transfer')).toBeNull()
    expect(normalizeKind('')).toBeNull()
  })
})

describe('normalizeRow', () => {
  const headers = ['date', 'amount', 'vendor', 'category', 'currency', 'kind']
  const mapping = {
    date: 'date',
    amount: 'amount',
    vendor: 'vendor',
    category: 'category',
    currency: 'currency',
    kindColumn: 'kind',
  }

  it('sign mode: negative amount -> expense, absolute value used', () => {
    const row = ['2026-01-01', '-1500', 'Cargills', 'Groceries', 'LKR', '']
    const result = normalizeRow(headers, row, mapping, 'sign')
    expect(result).toEqual({
      kind: 'expense',
      date: '2026-01-01',
      amount: 1500,
      currency: 'LKR',
      vendorOrSource: 'Cargills',
      category: 'Groceries',
    })
  })

  it('sign mode: positive amount -> income', () => {
    const row = ['2026-01-01', '5000', 'Employer', '', '', '']
    const result = normalizeRow(headers, row, mapping, 'sign')
    expect(result).toMatchObject({ kind: 'income', amount: 5000, currency: 'LKR' })
  })

  it('column mode: reads kind from the mapped column', () => {
    const row = ['2026-01-01', '200', 'Keells', '', '', 'expense']
    const result = normalizeRow(headers, row, mapping, 'column')
    expect(result).toMatchObject({ kind: 'expense', amount: 200 })
  })

  it('column mode: errors on an unrecognized kind value', () => {
    const row = ['2026-01-01', '200', 'Keells', '', '', 'transfer']
    const result = normalizeRow(headers, row, mapping, 'column')
    expect(result).toEqual({ error: 'unrecognized kind value' })
  })

  it('all-expense / all-income modes force the kind regardless of sign', () => {
    const row = ['2026-01-01', '-200', 'Keells', '', '', '']
    expect(normalizeRow(headers, row, mapping, 'all-expense')).toMatchObject({
      kind: 'expense',
      amount: 200,
    })
    expect(normalizeRow(headers, row, mapping, 'all-income')).toMatchObject({
      kind: 'income',
      amount: 200,
    })
  })

  it('errors on missing date, vendor, or amount', () => {
    expect(
      normalizeRow(headers, ['', '100', 'Keells', '', '', ''], mapping, 'sign'),
    ).toEqual({ error: 'missing date' })
    expect(
      normalizeRow(headers, ['2026-01-01', '100', '', '', '', ''], mapping, 'sign'),
    ).toEqual({ error: 'missing vendor' })
    expect(
      normalizeRow(
        headers,
        ['2026-01-01', 'not-a-number', 'Keells', '', '', ''],
        mapping,
        'sign',
      ),
    ).toEqual({ error: 'missing/invalid amount' })
  })

  it('strips thousands separators from the amount column', () => {
    const row = ['2026-01-01', '1,234,567', 'Keells', '', '', '']
    const result = normalizeRow(headers, row, mapping, 'sign')
    expect(result).toMatchObject({ amount: 1234567 })
  })

  it('defaults currency to LKR when unmapped/blank', () => {
    const row = ['2026-01-01', '100', 'Keells', '', '', '']
    const result = normalizeRow(headers, row, { ...mapping, currency: '' }, 'sign')
    expect(result).toMatchObject({ currency: 'LKR' })
  })
})
