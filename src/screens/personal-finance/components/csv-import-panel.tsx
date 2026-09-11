import { useRef, useState } from 'react'
import {
  buttonClass,
  confirmButtonClassLarge,
  dangerTone,
  inputClass,
  positiveTone,
  warningTone,
} from '../shared-styles'
import type { PersonalFinancePayload } from '../types'

/**
 * Bulk CSV import — the counterpart to the one-email/photo-at-a-time
 * ingestion pipeline (PendingIngestionPanel). Parses and column-maps
 * entirely client-side; the server (import_transactions_csv) only ever
 * receives already-normalized rows, never raw CSV text or a specific
 * bank's column layout.
 *
 * Column auto-detection matches this app's own CSV export
 * (finance-export.ts's transactionsCsv header: date, kind, counterparty,
 * category, subcategory, account, to_account, currency, amount,
 * amount_lkr, status, tags, notes, source) so re-importing an exported
 * file needs no manual mapping — but any CSV with a header row works via
 * the dropdowns.
 */

type ParsedCsv = { headers: Array<string>; rows: Array<Array<string>> }

type ColumnMapping = {
  date: string
  amount: string
  vendor: string
  category: string
  currency: string
  kindColumn: string
}

type KindMode = 'all-expense' | 'all-income' | 'sign' | 'column'

/** Minimal RFC-4180-ish parser: handles quoted fields (with escaped "" and embedded commas/newlines). No streaming — fine for a manual bulk-import file. */
export function parseCsv(text: string): ParsedCsv {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (nonEmpty.length === 0) return { headers: [], rows: [] }
  const [headers, ...dataRows] = nonEmpty
  return { headers, rows: dataRows }
}

export function autoDetect(headers: Array<string>): ColumnMapping {
  const norm = headers.map((h) => h.trim().toLowerCase())
  const find = (...candidates: Array<string>) => {
    for (const c of candidates) {
      const i = norm.indexOf(c)
      if (i >= 0) return headers[i]
    }
    return ''
  }
  return {
    date: find('date', 'transaction date', 'posted date'),
    amount: find('amount', 'amount_lkr'),
    vendor: find('counterparty', 'vendor', 'description', 'payee', 'merchant'),
    category: find('category'),
    currency: find('currency'),
    kindColumn: find('kind', 'type'),
  }
}

export function normalizeKind(raw: string): 'income' | 'expense' | null {
  const v = raw.trim().toLowerCase()
  if (['income', 'credit', 'in', 'deposit'].includes(v)) return 'income'
  if (['expense', 'debit', 'out', 'withdrawal'].includes(v)) return 'expense'
  return null
}

type Normalized = {
  kind: 'income' | 'expense'
  date: string
  amount: number
  currency: string
  vendorOrSource: string
  category?: string
}

export function normalizeRow(
  headers: Array<string>,
  row: Array<string>,
  mapping: ColumnMapping,
  kindMode: KindMode,
): Normalized | { error: string } {
  const col = (name: string) => {
    const i = headers.indexOf(name)
    return i >= 0 ? (row[i] ?? '').trim() : ''
  }
  const date = col(mapping.date)
  const vendorOrSource = col(mapping.vendor)
  const rawAmount = Number(col(mapping.amount).replace(/[,\s]/g, ''))
  if (!date) return { error: 'missing date' }
  if (!vendorOrSource) return { error: 'missing vendor' }
  if (!Number.isFinite(rawAmount) || rawAmount === 0)
    return { error: 'missing/invalid amount' }

  let kind: 'income' | 'expense'
  let amount = rawAmount
  if (kindMode === 'all-expense') kind = 'expense'
  else if (kindMode === 'all-income') kind = 'income'
  else if (kindMode === 'sign') kind = rawAmount < 0 ? 'expense' : 'income'
  else {
    const detected = normalizeKind(col(mapping.kindColumn))
    if (!detected) return { error: 'unrecognized kind value' }
    kind = detected
  }
  amount = Math.abs(amount)

  return {
    kind,
    date,
    amount,
    currency: col(mapping.currency) || 'LKR',
    vendorOrSource,
    category: col(mapping.category) || undefined,
  }
}

export function CsvImportPanel({
  onPayload,
}: {
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [kindMode, setKindMode] = useState<KindMode>('sign')
  const [importing, setImporting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [result, setResult] = useState<{
    created: number
    skippedDuplicates: number
    errors: Array<{ index: number; reason: string }>
  } | null>(null)

  function onFile(file: File) {
    setNote(null)
    setResult(null)
    file.text().then((text) => {
      const csv = parseCsv(text)
      if (csv.headers.length === 0) {
        setNote('Could not read a header row from this file.')
        return
      }
      setParsed(csv)
      const detected = autoDetect(csv.headers)
      setMapping(detected)
      setKindMode(detected.kindColumn ? 'column' : 'sign')
    })
  }

  const normalizedPreview =
    parsed && mapping
      ? parsed.rows
          .slice(0, 5)
          .map((row) => normalizeRow(parsed.headers, row, mapping, kindMode))
      : []

  async function runImport() {
    if (!parsed || !mapping) return
    setImporting(true)
    setNote(null)
    setResult(null)
    try {
      const normalized = parsed.rows.map((row) =>
        normalizeRow(parsed.headers, row, mapping, kindMode),
      )
      const rows = normalized.filter(
        (r): r is Normalized => !('error' in r),
      )
      const rowErrors = normalized
        .map((r, i) => ('error' in r ? { index: i, reason: r.error } : null))
        .filter((e): e is { index: number; reason: string } => e !== null)
      if (rows.length === 0) {
        setNote('No valid rows to import — check your column mapping.')
        return
      }
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'import_transactions_csv', rows }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        created?: number
        skippedDuplicates?: number
        errors?: Array<{ index: number; reason: string }>
      }
      if (!data.ok) {
        setNote(data.error || 'Import failed')
        return
      }
      setResult({
        created: data.created ?? 0,
        skippedDuplicates: data.skippedDuplicates ?? 0,
        // Row indices from client-side validation come first, then the
        // server's own — kept separate arrays would double-count indices,
        // so just report the total distinct failure count via length sum.
        errors: [...rowErrors, ...(data.errors ?? [])],
      })
      onPayload(data as unknown as PersonalFinancePayload)
      setParsed(null)
      setMapping(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
      <h3 className="text-sm font-medium text-[var(--theme-text)]">
        Bulk CSV import
      </h3>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Bulk-load transaction history from a bank-statement CSV or this app's
        own export, instead of one email/photo at a time.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
        }}
      />
      {!parsed && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`${buttonClass} mt-3`}
        >
          Choose CSV file
        </button>
      )}

      {parsed && mapping && (
        <div className="mt-3">
          <p className="text-xs text-[var(--theme-muted)]">
            {parsed.rows.length} row(s) found. Map columns below (auto-detected
            where possible).
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(
              [
                ['date', 'Date'],
                ['amount', 'Amount'],
                ['vendor', 'Vendor / counterparty'],
                ['category', 'Category (optional)'],
                ['currency', 'Currency (optional)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-xs text-[var(--theme-muted)]">
                {label}
                <select
                  value={mapping[key]}
                  onChange={(e) =>
                    setMapping({ ...mapping, [key]: e.target.value })
                  }
                  className={`${inputClass} mt-1 w-full`}
                >
                  <option value="">— none —</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-3">
            <p className="text-xs text-[var(--theme-muted)]">
              How to tell income from expense:
            </p>
            <div className="mt-1 flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={kindMode === 'sign'}
                  onChange={() => setKindMode('sign')}
                />
                Negative = expense, positive = income
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={kindMode === 'column'}
                  onChange={() => setKindMode('column')}
                  disabled={!mapping.kindColumn && parsed.headers.length === 0}
                />
                Use a column
                {kindMode === 'column' && (
                  <select
                    value={mapping.kindColumn}
                    onChange={(e) =>
                      setMapping({ ...mapping, kindColumn: e.target.value })
                    }
                    className={`${inputClass} ml-1`}
                  >
                    <option value="">— pick column —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={kindMode === 'all-expense'}
                  onChange={() => setKindMode('all-expense')}
                />
                Everything is an expense
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={kindMode === 'all-income'}
                  onChange={() => setKindMode('all-income')}
                />
                Everything is income
              </label>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <p className="text-xs text-[var(--theme-muted)]">
              Preview (first 5 rows):
            </p>
            <table className="mt-1 w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--theme-muted)]">
                  <th className="pr-3">Kind</th>
                  <th className="pr-3">Date</th>
                  <th className="pr-3">Vendor</th>
                  <th className="pr-3">Amount</th>
                  <th className="pr-3">Currency</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {normalizedPreview.map((r, i) =>
                  'error' in r ? (
                    <tr key={i} className={dangerTone}>
                      <td colSpan={6}>Row {i + 1}: {r.error}</td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td className="pr-3">{r.kind}</td>
                      <td className="pr-3">{r.date}</td>
                      <td className="pr-3">{r.vendorOrSource}</td>
                      <td className="pr-3">{r.amount}</td>
                      <td className="pr-3">{r.currency}</td>
                      <td>{r.category ?? ''}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          {note && <p className={`mt-2 text-xs ${dangerTone}`}>{note}</p>}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={() => void runImport()}
              className={confirmButtonClassLarge}
            >
              {importing ? 'Importing…' : `Import ${parsed.rows.length} row(s)`}
            </button>
            <button
              type="button"
              onClick={() => {
                setParsed(null)
                setMapping(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className={buttonClass}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-xl border border-[var(--theme-border)]/60 p-3 text-xs">
          <p className={positiveTone}>{result.created} record(s) created.</p>
          {result.skippedDuplicates > 0 && (
            <p className={warningTone}>
              {result.skippedDuplicates} row(s) skipped as likely duplicates
              (same vendor/date/amount already on record).
            </p>
          )}
          {result.errors.length > 0 && (
            <div className={`mt-1 ${dangerTone}`}>
              <p>{result.errors.length} row(s) had errors:</p>
              <ul className="ml-4 list-disc">
                {result.errors.slice(0, 10).map((e) => (
                  <li key={e.index}>
                    Row {e.index + 1}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
