function textValue(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('en-LK')
  return String(value)
}

export function DataTable({
  title,
  rows,
  columns,
}: {
  title: string
  rows: Array<Record<string, unknown>>
  columns: Array<string>
}) {
  return (
    <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          {title}
        </h2>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
          {rows.length} records
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--theme-muted)]">
          No records yet. Add records through /api/finance or future forms; the
          database is initialized and ready.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="border-b border-[var(--theme-border)] py-2 pr-4"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(-8).map((row, index) => (
                <tr
                  key={String(row.id ?? index)}
                  className="text-[var(--theme-text)]"
                >
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="border-b border-[var(--theme-border)]/60 py-2 pr-4"
                    >
                      {textValue(row, column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
