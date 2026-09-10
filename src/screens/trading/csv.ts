/** CSV export helpers shared by the trading panels. Extracted from trading-screen.tsx. */

export type CsvValue = string | number | boolean | null | undefined
export function csvValue(value: CsvValue): string {
  if (value == null) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
export function downloadCsv(filename: string, rows: Array<Record<string, CsvValue>>) {
  if (rows.length === 0 || typeof document === 'undefined') return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.map(csvValue).join(','),
    ...rows.map((row) =>
      headers.map((header) => csvValue(row[header])).join(','),
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
export function csvDateSuffix() {
  return new Date().toISOString().slice(0, 10)
}
