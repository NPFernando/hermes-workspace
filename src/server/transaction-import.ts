import { createHash } from 'node:crypto'
import { getUnifiedTransactions } from './finance-store'
import type { FinanceDatabase, UnifiedTransaction } from './finance-store'

const MAX_CSV_BYTES = 2_000_000
const MAX_ROWS = 5_000

export type TransactionImportItem =
  | { type: 'income' | 'expense'; payload: Record<string, unknown>; rowNumbers: Array<number> }
  | { type: 'transfer'; payload: Record<string, unknown>; rowNumbers: Array<number> }
  | { type: 'split'; payload: Record<string, unknown>; rowNumbers: Array<number> }

export type TransactionImportPreview = {
  fingerprint: string
  rowCount: number
  items: Array<TransactionImportItem>
  errors: Array<string>
  duplicates: Array<{ rowNumbers: Array<number>; kind: string; date: string; counterparty: string; amount: number }>
}

function csvCell(value: string): string {
  return value.trim()
}

function parseCsv(text: string): { headers: Array<string>; rows: Array<Array<string>>; errors: Array<string> } {
  const errors: Array<string> = []
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
    return { headers: [], rows: [], errors: ['CSV exceeds the 2 MB import limit'] }
  }
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += character
      }
      continue
    }
    if (character === '"' && cell.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(csvCell(cell))
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(csvCell(cell))
      cell = ''
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
    } else {
      cell += character
    }
  }
  if (quoted) errors.push('CSV contains an unterminated quoted field')
  if (cell.length > 0 || row.length > 0) {
    row.push(csvCell(cell))
    if (row.some((value) => value !== '')) rows.push(row)
  }
  if (rows.length === 0) return { headers: [], rows: [], errors: ['CSV is empty'] }
  const headers = rows.shift()!.map((header) => header.replace(/^\uFEFF/, ''))
  if (rows.length > MAX_ROWS) errors.push(`CSV exceeds the ${MAX_ROWS}-row import limit`)
  return { headers, rows: rows.slice(0, MAX_ROWS), errors }
}

function finiteAmount(value: string): number | null {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function requiredDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

function rowRecord(headers: Array<string>, values: Array<string>): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
}

function duplicateFor(
  transactions: Array<UnifiedTransaction>,
  kind: 'income' | 'expense',
  date: string,
  counterparty: string,
  amount: number,
): boolean {
  const normalizedCounterparty = counterparty.toLowerCase()
  return transactions.some(
    (transaction) =>
      transaction.kind === kind &&
      transaction.date.slice(0, 10) === date &&
      transaction.counterparty.toLowerCase() === normalizedCounterparty &&
      Math.abs(transaction.amount - amount) < 0.01,
  )
}

export function prepareTransactionImport(
  text: string,
  db: FinanceDatabase,
): TransactionImportPreview {
  const fingerprint = createHash('sha256').update(text).digest('hex')
  const parsed = parseCsv(text)
  const requiredHeaders = ['kind', 'date', 'counterparty', 'category', 'currency', 'amount']
  const missingHeaders = requiredHeaders.filter((header) => !parsed.headers.includes(header))
  if (missingHeaders.length > 0) {
    parsed.errors.push(`Missing required CSV columns: ${missingHeaders.join(', ')}`)
  }
  if (parsed.errors.length > 0 && parsed.headers.length === 0) {
    return { fingerprint, rowCount: 0, items: [], errors: parsed.errors, duplicates: [] }
  }

  const records = parsed.rows.map((values, index) => ({
    rowNumber: index + 2,
    record: rowRecord(parsed.headers, values),
  }))
  const errors = [...parsed.errors]
  const ordinary: Array<{
    rowNumber: number
    record: Record<string, string>
    kind: 'income' | 'expense'
    amount: number
  }> = []
  const grouped = new Map<string, typeof records>()

  for (const { rowNumber, record } of records) {
    const values = parsed.rows[rowNumber - 2]
    if (values.length > parsed.headers.length) {
      errors.push(
        `Row ${rowNumber}: expected ${parsed.headers.length} columns but found ${values.length}`,
      )
      continue
    }
    const rawKind = record.kind
    const amount = finiteAmount(record.amount)
    if (rawKind !== 'income' && rawKind !== 'expense') {
      errors.push(`Row ${rowNumber}: kind must be income or expense`)
      continue
    }
    const kind = rawKind
    if (!requiredDate(record.date)) {
      errors.push(`Row ${rowNumber}: date must use YYYY-MM-DD`)
      continue
    }
    if (!record.counterparty || !record.category || !record.currency) {
      errors.push(`Row ${rowNumber}: counterparty, category, and currency are required`)
      continue
    }
    if (
      record.accountId &&
      !db.finance_accounts.some((account) => account.id === record.accountId)
    ) {
      errors.push(`Row ${rowNumber}: accountId does not match an existing account`)
      continue
    }
    if (
      record.transferAccountId &&
      !db.finance_accounts.some(
        (account) => account.id === record.transferAccountId,
      )
    ) {
      errors.push(`Row ${rowNumber}: transferAccountId does not match an existing account`)
      continue
    }
    if (amount === null) {
      errors.push(`Row ${rowNumber}: amount must be greater than zero`)
      continue
    }
    const groupId = record.transferId || record.splitGroupId
    if (groupId) {
      const group = grouped.get(groupId) ?? []
      group.push({ rowNumber, record })
      grouped.set(groupId, group)
    } else {
      ordinary.push({ rowNumber, record, kind, amount })
    }
  }

  const items: Array<TransactionImportItem> = []
  for (const entry of ordinary) {
    const { record, kind } = entry
    const payload =
      kind === 'income'
        ? {
            dateReceived: record.date,
            sourceName: record.counterparty,
            incomeType: record.category,
            originalCurrency: record.currency,
            originalAmount: entry.amount,
            exchangeRateUsed: 1,
            convertedLkrAmount: Number(record.convertedLkrAmount) || entry.amount,
            taxable: record.taxable === 'true',
            accountId: record.accountId || undefined,
            status: record.status || 'cleared',
            tags: record.tags || undefined,
          }
        : {
            date: record.date,
            vendor: record.counterparty,
            category: record.category,
            subcategory: record.subcategory || undefined,
            currency: record.currency,
            amount: entry.amount,
            convertedLkrAmount: Number(record.convertedLkrAmount) || entry.amount,
            recurring: record.recurring === 'true',
            workRelated: record.workRelated === 'true',
            taxDeductiblePossible: record.taxDeductiblePossible === 'true',
            accountId: record.accountId || undefined,
            status: record.status || 'cleared',
            tags: record.tags || undefined,
          }
    items.push({ type: kind, payload, rowNumbers: [entry.rowNumber] })
  }

  for (const [groupId, group] of grouped) {
    const first = group[0].record
    if (first.transferId) {
      const income = group.find((entry) => entry.record.kind === 'income')
      const expense = group.find((entry) => entry.record.kind === 'expense')
      const incomeAmount = income ? finiteAmount(income.record.amount) : null
      const expenseAmount = expense ? finiteAmount(expense.record.amount) : null
      if (!income || !expense || incomeAmount === null || expenseAmount === null || incomeAmount !== expenseAmount) {
        errors.push(`Rows ${group.map((entry) => entry.rowNumber).join(', ')}: transfer must contain one matching income and expense row`)
        continue
      }
      if (income.record.currency !== expense.record.currency) {
        errors.push(`Rows ${group.map((entry) => entry.rowNumber).join(', ')}: transfer currencies must match`)
        continue
      }
      if (!income.record.accountId || !expense.record.accountId) {
        errors.push(`Rows ${group.map((entry) => entry.rowNumber).join(', ')}: transfer rows require source and destination account IDs`)
        continue
      }
      items.push({
        type: 'transfer',
        rowNumbers: group.map((entry) => entry.rowNumber),
        payload: {
          date: expense.record.date,
          sourceAccountId: expense.record.accountId,
          destinationAccountId: income.record.accountId,
          currency: expense.record.currency,
          amount: expenseAmount,
          convertedLkrAmount: Number(expense.record.convertedLkrAmount) || expenseAmount,
          status: expense.record.status || 'cleared',
          tags: expense.record.tags || undefined,
        },
      })
    } else {
      if (group.length < 2 || group.some((entry) => entry.record.kind !== 'expense')) {
        errors.push(`Rows ${group.map((entry) => entry.rowNumber).join(', ')}: split must contain at least two expense rows`)
        continue
      }
      items.push({
        type: 'split',
        rowNumbers: group.map((entry) => entry.rowNumber),
        payload: {
          date: first.date,
          vendor: first.counterparty,
          accountId: first.accountId || undefined,
          currency: first.currency,
          status: first.status || 'cleared',
          tags: first.tags || undefined,
          splits: group.map((entry) => ({
            category: entry.record.category,
            amount: finiteAmount(entry.record.amount) ?? 0,
            convertedLkrAmount: Number(entry.record.convertedLkrAmount) || finiteAmount(entry.record.amount) || 0,
          })),
        },
      })
    }
  }

  const transactions = getUnifiedTransactions(db)
  const duplicates = items.flatMap((item) => {
    if (item.type === 'transfer' || item.type === 'split') return []
    const payload = item.payload
    const kind = item.type
    const date = String(kind === 'income' ? payload.dateReceived : payload.date)
    const counterparty = String(kind === 'income' ? payload.sourceName : payload.vendor)
    const amount = Number(kind === 'income' ? payload.originalAmount : payload.amount)
    return duplicateFor(transactions, kind, date, counterparty, amount)
      ? [{ rowNumbers: item.rowNumbers, kind, date, counterparty, amount }]
      : []
  })
  return { fingerprint, rowCount: records.length, items, errors, duplicates }
}
