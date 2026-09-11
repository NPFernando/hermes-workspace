import { useEffect, useMemo, useState } from 'react'
import { buttonClass, inputClass } from '../shared-styles'

type FinanceDocument = {
  id: string
  name: string
  kind: 'finance_account' | 'income_source' | 'income_record' | 'expense_record' | 'stock_holding' | 'fixed_deposit' | 'tax_record' | 'insurance_policy' | 'pending_ingestion'
  status: string
  source: string
  label: string
  createdAt: string
  updatedAt: string
  bytes: number | null
  recordId?: string
  pendingId?: string
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'File unavailable'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function documentHref(document: FinanceDocument): string | null {
  if (document.kind === 'pending_ingestion' && document.pendingId) {
    return `/api/finance-upload?id=${encodeURIComponent(document.pendingId)}`
  }
  if (document.recordId && document.kind !== 'pending_ingestion') {
    return `/api/finance-document?kind=${encodeURIComponent(document.kind)}&id=${encodeURIComponent(document.recordId)}`
  }
  return null
}

/** DOC-100: metadata-only inventory over existing finance documents. */
export function DocumentVaultPanel() {
  const [documents, setDocuments] = useState<Array<FinanceDocument>>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetch('/api/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'list_finance_documents' }),
    })
      .then(async (response) => {
        const data = (await response.json()) as { financeDocuments?: Array<FinanceDocument>; error?: string }
        if (!response.ok || !data.financeDocuments) throw new Error(data.error || 'Documents unavailable')
        return data.financeDocuments
      })
      .then((nextDocuments) => {
        if (active) setDocuments(nextDocuments)
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : 'Documents unavailable')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return documents
    return documents.filter((document) =>
      `${document.name} ${document.label} ${document.kind} ${document.status}`.toLowerCase().includes(normalized),
    )
  }, [documents, query])

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Document vault</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            A safe inventory of uploaded and linked finance documents. File paths and contents stay server-side.
          </p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] text-[var(--theme-muted)]">
          {filtered.length}/{documents.length} documents
        </span>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search documents"
        className={`${inputClass} mt-3 w-full sm:max-w-sm`}
        aria-label="Search documents"
      />
      {loading && <p className="mt-3 text-xs text-[var(--theme-muted)]">Loading document inventory…</p>}
      {error && <p className="mt-3 text-xs text-[var(--theme-danger)]">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="mt-3 text-xs text-[var(--theme-muted)]">No documents found. Uploaded documents will appear here after intake.</p>
      )}
      {filtered.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {filtered.map((document) => {
            const href = documentHref(document)
            return (
              <div key={document.id} className="rounded-2xl border border-[var(--theme-border)]/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-[var(--theme-text)]">{document.name}</p>
                    <p className="mt-1 text-[11px] text-[var(--theme-muted)]">{document.label} · {document.kind.replaceAll('_', ' ')}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-[10px] capitalize text-[var(--theme-muted)]">{document.status.replaceAll('_', ' ')}</span>
                </div>
                <p className="mt-2 text-[10px] text-[var(--theme-muted)]">{formatBytes(document.bytes)} · source: {document.source}</p>
                {href && (
                  <a href={href} target="_blank" rel="noreferrer" className={`${buttonClass} mt-2 inline-block`}>
                    View document
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
