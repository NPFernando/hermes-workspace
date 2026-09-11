import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buttonClass, confirmButtonClassLarge, dangerButtonClassLarge, dangerTone, infoTone, inputClass, positiveTone, warningTone } from '../shared-styles'
import { formatDateOnly, formatDateTime } from '../utils'
import type {
  ContractChange,
  ExtractedContract,
  ExtractedContractNote,
  ExtractedFdCertificate,
  ExtractedSalarySlip,
  ExtractedTransaction,
  PendingIngestion,
  PersonalFinancePayload,
} from '../types'

type DuplicateWarning = { date: string; amount: number; vendorOrSource: string }

const confidenceTone: Record<ExtractedTransaction['confidence'], string> = {
  high: positiveTone,
  medium: warningTone,
  low: dangerTone,
}

const severityTone: Record<'high' | 'medium' | 'low', string> = {
  high: dangerTone,
  medium: warningTone,
  low: infoTone,
}

/** AI-307/309: rank items needing the most attention first. */
export function inboxPriorityScore(item: PendingIngestion): number {
  if (item.error && !item.extracted && !item.extractedSalarySlip && !item.extractedContractNote && !item.extractedFdCertificate && !item.extractedContract) return 0
  if (
    item.documentType === 'transaction' &&
    item.extracted?.kind === 'expense' &&
    !item.extracted.category?.trim()
  )
    return 1
  const confidence =
    item.extracted?.confidence ??
    item.extractedSalarySlip?.confidence ??
    item.extractedContractNote?.confidence ??
    item.extractedFdCertificate?.confidence ??
    item.extractedContract?.confidence
  if (confidence === 'low' || !confidence) return 1
  if (confidence === 'medium') return 2
  return 3
}

function priorityLabel(item: PendingIngestion): string | null {
  const score = inboxPriorityScore(item)
  if (score === 0) return 'Needs attention'
  if (score === 1) return 'Review carefully'
  return null
}

export function isBatchApprovable(item: PendingIngestion): boolean {
  return Boolean(
    item.status === 'awaiting_review' &&
      (item.documentType === 'transaction' || item.documentType === 'statement') &&
      item.extracted &&
      Number.isFinite(item.extracted.amount),
  )
}

/** DOC-112: search only user-facing metadata; never expose sourceRef paths. */
export function matchesDocumentSearch(
  item: PendingIngestion,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const searchable = [
    item.documentType,
    item.source,
    item.status,
    item.error,
    item.extracted?.vendorOrSource,
    item.extracted?.category,
    item.extractedSalarySlip?.employerName,
    item.extractedSalarySlip?.payPeriod,
    item.extractedContractNote?.symbol,
    item.extractedContractNote?.companyName,
    item.extractedFdCertificate?.bankName,
    item.extractedContract?.employerName,
    item.extractedContract?.jobTitle,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return searchable.includes(normalized)
}

/**
 * AI-assisted intake: upload a receipt/bill photo or PDF, or sync Gmail —
 * every extracted item lands here for review and never touches real
 * income/expense records until the user confirms it.
 */
export function PendingIngestionPanel({
  payload,
  onConfirmed,
}: {
  payload: PersonalFinancePayload
  onConfirmed: (payload: PersonalFinancePayload) => void
}) {
  const [items, setItems] = useState<Array<PendingIngestion>>([])
  const [documentQuery, setDocumentQuery] = useState('')
  const activeItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status === 'awaiting_password' || item.status === 'awaiting_review',
      ),
    [items],
  )
  const filteredActiveItems = useMemo(
    () => activeItems.filter((item) => matchesDocumentSearch(item, documentQuery)),
    [activeItems, documentQuery],
  )
  const historyItems = useMemo(
    () =>
      items
        .filter((item) => item.status === 'confirmed' || item.status === 'rejected')
        .filter((item) => matchesDocumentSearch(item, documentQuery))
        .slice()
        .sort((a, b) =>
          (b.updatedAt ?? b.createdAt ?? '').localeCompare(
            a.updatedAt ?? a.createdAt ?? '',
          ),
        ),
    [documentQuery, items],
  )
  const sortedItems = useMemo(
    () =>
      [...filteredActiveItems].sort((a, b) => {
        const priority = inboxPriorityScore(a) - inboxPriorityScore(b)
        return priority
      }),
    [filteredActiveItems],
  )
  const missingCategoryCount = useMemo(
    () =>
      activeItems.filter(
        (item) =>
          (item.documentType === 'transaction' || item.documentType === 'statement') &&
          item.extracted?.kind === 'expense' &&
          !item.extracted.category?.trim(),
      ).length,
    [activeItems],
  )
  const [showMissingCategories, setShowMissingCategories] = useState(false)
  const visibleItems = useMemo(
    () =>
      showMissingCategories
        ? sortedItems.filter(
            (item) =>
              (item.documentType === 'transaction' || item.documentType === 'statement') &&
              item.extracted?.kind === 'expense' &&
              !item.extracted.category?.trim(),
          )
        : sortedItems,
    [showMissingCategories, sortedItems],
  )
  const [uploading, setUploading] = useState(false)
  const [uploadingStatement, setUploadingStatement] = useState(false)
  const [uploadingContract, setUploadingContract] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>(
    {},
  )
  const [editDrafts, setEditDrafts] = useState<
    Record<string, Partial<ExtractedTransaction>>
  >({})
  const [contractDrafts, setContractDrafts] = useState<
    Record<string, Partial<ExtractedContract>>
  >({})
  const [salarySlipDrafts, setSalarySlipDrafts] = useState<
    Record<string, Partial<ExtractedSalarySlip>>
  >({})
  const [contractNoteDrafts, setContractNoteDrafts] = useState<
    Record<string, Partial<ExtractedContractNote>>
  >({})
  const [fdCertificateDrafts, setFdCertificateDrafts] = useState<
    Record<string, Partial<ExtractedFdCertificate>>
  >({})
  const [targetJobDrafts, setTargetJobDrafts] = useState<
    Record<string, string>
  >({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [batchBusy, setBatchBusy] = useState(false)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailLastSyncedAtSeconds, setGmailLastSyncedAtSeconds] = useState<
    number | null
  >(null)
  const [gmailSyncHistory, setGmailSyncHistory] = useState<
    Array<{
      at: number
      found: number
      queued: number
      skippedAlreadyQueued: number
    }>
  >([])
  const [syncing, setSyncing] = useState(false)
  const [duplicateWarnings, setDuplicateWarnings] = useState<
    Record<string, DuplicateWarning>
  >({})
  // Some formats (notably HEIC/HEIF from phone cameras) extract fine
  // server-side but no mainstream browser can decode them in an <img> tag —
  // track which previews failed to load so we can show a placeholder
  // instead of a broken-image icon.
  const [previewFailedIds, setPreviewFailedIds] = useState<
    Record<string, boolean>
  >({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const statementFileInputRef = useRef<HTMLInputElement | null>(null)
  const contractFileInputRef = useRef<HTMLInputElement | null>(null)

  const batchApprovableItems = useMemo(
    () => activeItems.filter(isBatchApprovable),
    [activeItems],
  )
  const selectedBatchItems = useMemo(
    () => batchApprovableItems.filter((item) => selectedIds[item.id]),
    [batchApprovableItems, selectedIds],
  )

  const checkGmailConnection = useCallback(() => {
    return fetch('/api/auth/gmail-connect?check=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then(
        (data: {
          connected?: boolean
          lastSyncedAtSeconds?: number | null
          syncHistory?: Array<{
            at: number
            found: number
            queued: number
            skippedAlreadyQueued: number
          }>
        }) => {
          setGmailConnected(Boolean(data.connected))
          setGmailLastSyncedAtSeconds(data.lastSyncedAtSeconds ?? null)
          setGmailSyncHistory(data.syncHistory ?? [])
        },
      )
      .catch(() => {})
  }, [])

  useEffect(() => {
    void checkGmailConnection()
  }, [checkGmailConnection])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list_pending_ingestions' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        pendingIngestions?: Array<PendingIngestion>
      }
      if (data.ok) {
        setItems(data.pendingIngestions ?? [])
      }
    } catch {
      /* transient */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function syncGmail() {
    setSyncing(true)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync_gmail_now' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        result?: { found: number; queued: number; skippedAlreadyQueued: number }
      }
      if (!data.ok) setNote(data.error || 'Gmail sync failed')
      else if (data.result)
        setNote(
          `Found ${data.result.found}, queued ${data.result.queued} for review.`,
        )
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Gmail sync failed')
    } finally {
      setSyncing(false)
      void checkGmailConnection()
    }
  }

  async function uploadFile(
    file: File,
    documentType: 'transaction' | 'statement' | 'contract' = 'transaction',
  ) {
    const setBusy =
      documentType === 'contract'
        ? setUploadingContract
        : documentType === 'statement'
          ? setUploadingStatement
          : setUploading
    setBusy(true)
    setNote(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('documentType', documentType)
      const res = await fetch('/api/finance-upload', {
        method: 'POST',
        body: form,
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Upload failed')
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (statementFileInputRef.current) statementFileInputRef.current.value = ''
      if (contractFileInputRef.current) contractFileInputRef.current.value = ''
    }
  }

  async function submitPassword(id: string) {
    const password = (passwordDrafts[id] ?? '').trim()
    if (!password) return
    setBusyId(id)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_ingestion_password',
          id,
          password,
        }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Could not unlock document')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reject_pending_ingestion', id }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function confirmItem(item: PendingIngestion, force = false) {
    const draft = { ...item.extracted, ...editDrafts[item.id] }
    if (!draft.kind || !Number.isFinite(draft.amount)) {
      setNote('Amount and type are required before confirming.')
      return
    }
    setBusyId(item.id)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_pending_ingestion',
          id: item.id,
          payload: draft,
          force,
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        duplicateWarning?: {
          date: string
          amount: number
          vendorOrSource: string
        }
      }
      if (data.ok === false) {
        setNote(data.error || 'Confirm failed')
        return
      }
      if (data.duplicateWarning) {
        setDuplicateWarnings((prev) => ({
          ...prev,
          [item.id]: data.duplicateWarning!,
        }))
        return
      }
      setDuplicateWarnings((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      onConfirmed(data as PersonalFinancePayload)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmSelected() {
    if (selectedBatchItems.length === 0) return
    setBatchBusy(true)
    setNote(null)
    try {
      // Keep confirmations sequential: each item retains the existing
      // duplicate-warning response and the server remains the source of truth.
      for (const item of selectedBatchItems) await confirmItem(item)
    } finally {
      setSelectedIds({})
      setBatchBusy(false)
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((previous) => ({ ...previous, [id]: !previous[id] }))
  }

  function toggleAllBatchItems() {
    const allSelected =
      batchApprovableItems.length > 0 &&
      batchApprovableItems.every((item) => selectedIds[item.id])
    setSelectedIds(
      allSelected
        ? {}
        : Object.fromEntries(batchApprovableItems.map((item) => [item.id, true])),
    )
  }

  function updateDraft(id: string, patch: Partial<ExtractedTransaction>) {
    setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function updateContractDraft(id: string, patch: Partial<ExtractedContract>) {
    setContractDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function updateSalarySlipDraft(
    id: string,
    patch: Partial<ExtractedSalarySlip>,
  ) {
    setSalarySlipDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function confirmSalarySlipItem(item: PendingIngestion) {
    const draft = { ...item.extractedSalarySlip, ...salarySlipDrafts[item.id] }
    if (
      !draft.employerName?.trim() ||
      !draft.paymentDate?.trim() ||
      typeof draft.netAmount !== 'number' ||
      !Number.isFinite(draft.netAmount) ||
      draft.netAmount <= 0
    ) {
      setNote('Employer, payment date, and positive net pay are required before confirming.')
      return
    }
    setBusyId(item.id)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_pending_ingestion',
          id: item.id,
          payload: draft,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (data.ok === false) {
        setNote(data.error || 'Confirm failed')
        return
      }
      onConfirmed(data as PersonalFinancePayload)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusyId(null)
    }
  }

  function updateContractNoteDraft(
    id: string,
    patch: Partial<ExtractedContractNote>,
  ) {
    setContractNoteDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function confirmContractNoteItem(item: PendingIngestion) {
    const draft = { ...item.extractedContractNote, ...contractNoteDrafts[item.id] }
    if (
      !draft.symbol?.trim() ||
      typeof draft.quantity !== 'number' ||
      !Number.isFinite(draft.quantity) ||
      draft.quantity <= 0 ||
      typeof draft.price !== 'number' ||
      !Number.isFinite(draft.price) ||
      draft.price <= 0
    ) {
      setNote('Symbol, positive quantity, and positive execution price are required before confirming.')
      return
    }
    setBusyId(item.id)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_pending_ingestion',
          id: item.id,
          payload: draft,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (data.ok === false) {
        setNote(data.error || 'Confirm failed')
        return
      }
      onConfirmed(data as PersonalFinancePayload)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusyId(null)
    }
  }

  function updateFdCertificateDraft(
    id: string,
    patch: Partial<ExtractedFdCertificate>,
  ) {
    setFdCertificateDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function confirmFdCertificateItem(item: PendingIngestion) {
    const draft = { ...item.extractedFdCertificate, ...fdCertificateDrafts[item.id] }
    if (
      !draft.bankName?.trim() ||
      typeof draft.principal !== 'number' ||
      !Number.isFinite(draft.principal) ||
      draft.principal <= 0 ||
      typeof draft.interestRatePct !== 'number' ||
      !Number.isFinite(draft.interestRatePct) ||
      draft.interestRatePct < 0
    ) {
      setNote('Bank, positive principal, and valid interest rate are required before confirming.')
      return
    }
    setBusyId(item.id)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_pending_ingestion',
          id: item.id,
          payload: draft,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (data.ok === false) {
        setNote(data.error || 'Confirm failed')
        return
      }
      onConfirmed(data as PersonalFinancePayload)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmContractItem(item: PendingIngestion) {
    const draft = { ...item.extractedContract, ...contractDrafts[item.id] }
    if (!draft.employerName || !draft.employmentType) {
      setNote(
        'Employer name and employment type are required before confirming.',
      )
      return
    }
    setBusyId(item.id)
    setNote(null)
    try {
      const targetIncomeSourceId = targetJobDrafts[item.id] || undefined
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_pending_ingestion',
          id: item.id,
          payload: { ...draft, targetIncomeSourceId },
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (data.ok === false) {
        setNote(data.error || 'Confirm failed')
        return
      }
      onConfirmed(data as PersonalFinancePayload)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI-assisted intake</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Upload a photo or document of a bill/receipt and AI extracts the
            details — nothing is added to your records until you review and
            confirm it below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadFile(file)
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className={buttonClass}
          >
            {uploading ? 'Processing…' : 'Upload receipt / bill'}
          </button>
          <input
            ref={statementFileInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadFile(file, 'statement')
            }}
          />
          <button
            type="button"
            disabled={uploadingStatement}
            onClick={() => statementFileInputRef.current?.click()}
            className={buttonClass}
          >
            {uploadingStatement ? 'Processing…' : 'Review bank statement'}
          </button>
          <input
            ref={contractFileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadFile(file, 'contract')
            }}
          />
          <button
            type="button"
            disabled={uploadingContract}
            onClick={() => contractFileInputRef.current?.click()}
            className={buttonClass}
          >
            {uploadingContract ? 'Processing…' : 'Upload employment contract'}
          </button>
          {gmailConnected ? (
            <button
              type="button"
              disabled={syncing}
              onClick={() => void syncGmail()}
              className={buttonClass}
            >
              {syncing ? 'Syncing…' : 'Sync Gmail now'}
            </button>
          ) : (
            <a href="/api/auth/gmail-connect" className={buttonClass}>
              Connect Gmail
            </a>
          )}
        </div>
      </div>

      {gmailConnected && (
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          {gmailLastSyncedAtSeconds
            ? `Last synced ${formatDateTime(gmailLastSyncedAtSeconds * 1000)}`
            : 'Never synced'}
        </p>
      )}

      {gmailConnected && gmailSyncHistory.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--theme-muted)]">
          {[...gmailSyncHistory].reverse().map((run) => (
            <span key={run.at}>
              {formatDateOnly(run.at * 1000)}: found {run.found},
              queued {run.queued}
            </span>
          ))}
        </div>
      )}

      {note && <p className="mt-2 text-xs text-[var(--theme-danger)]">{note}</p>}

      {items.length > 0 && (
        <div className="mt-3">
          <label className="sr-only" htmlFor="document-history-search">
            Search document history
          </label>
          <input
            id="document-history-search"
            type="search"
            value={documentQuery}
            onChange={(e) => setDocumentQuery(e.target.value)}
            placeholder="Search pending items and history by type, source, vendor, employer, or status"
            className={`${inputClass} w-full`}
          />
        </div>
      )}

      {activeItems.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          Nothing pending — upload a receipt or bill to try it.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--theme-muted)]">
              {activeItems.length} item{activeItems.length === 1 ? '' : 's'} awaiting review
            </span>
            {batchApprovableItems.length > 0 && (
              <>
                <button
                  type="button"
                  className={inputClass}
                  onClick={toggleAllBatchItems}
                  disabled={batchBusy}
                >
                  {batchApprovableItems.every((item) => selectedIds[item.id])
                    ? 'Clear selection'
                    : 'Select all transactions'}
                </button>
                <button
                  type="button"
                  className={confirmButtonClassLarge}
                  onClick={() => void confirmSelected()}
                  disabled={batchBusy || selectedBatchItems.length === 0}
                >
                  {batchBusy
                    ? 'Confirming…'
                    : `Confirm selected (${selectedBatchItems.length})`}
                </button>
              </>
            )}
            {missingCategoryCount > 0 && (
              <button
                type="button"
                onClick={() => setShowMissingCategories((value) => !value)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${showMissingCategories ? warningTone : inputClass}`}
              >
                {showMissingCategories ? 'Show all items' : 'Needs category'} ({missingCategoryCount})
              </button>
            )}
          </div>
          {visibleItems.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--theme-muted)]">
              No items match this inbox filter.
            </p>
          ) : (
            <div className="mt-3 grid gap-3">
          {visibleItems.map((item) => {
            const hasDuplicateWarning = Object.hasOwn(
              duplicateWarnings,
              item.id,
            )
            const duplicateWarning = duplicateWarnings[item.id]
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-start gap-3 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
              >
                {isBatchApprovable(item) && (
                  <input
                    type="checkbox"
                    checked={Boolean(selectedIds[item.id])}
                    disabled={batchBusy}
                    onChange={() => toggleSelected(item.id)}
                    aria-label={`Select ${item.extracted?.vendorOrSource || 'transaction'} for batch confirmation`}
                    className="mt-1 h-4 w-4 accent-[var(--theme-accent)]"
                  />
                )}
                {item.rawPreviewImagePath &&
                  (previewFailedIds[item.id] ? (
                    <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] p-2 text-center text-[10px] text-[var(--theme-muted)]">
                      Preview not available for this format
                    </div>
                  ) : (
                    <img
                      src={`/api/finance-upload?id=${item.id}`}
                      alt="Document preview"
                      className="h-24 w-24 rounded-xl border border-[var(--theme-border)]/60 object-cover"
                      onError={() =>
                        setPreviewFailedIds((prev) => ({
                          ...prev,
                          [item.id]: true,
                        }))
                      }
                    />
                  ))}

                <div className="min-w-[220px] flex-1">
                  <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
                    <span className="uppercase tracking-wide">
                      {item.source}
                    </span>
                    <span>·</span>
                    <span>{item.status.replace('_', ' ')}</span>
                    {item.documentClass && item.documentClass !== 'unknown' && (
                      <span className="rounded-lg border border-[var(--theme-border)] px-1.5 py-0.5 uppercase tracking-wide text-[10px]">
                        {item.documentClass.replaceAll('_', ' ')}
                      </span>
                    )}
                    {priorityLabel(item) && (
                      <span className={`rounded-lg border px-1.5 py-0.5 uppercase tracking-wide ${warningTone}`}>
                        {priorityLabel(item)}
                      </span>
                    )}
                  </div>

                  {item.status === 'awaiting_password' && (
                    <div className="mt-2">
                      {item.passwordHint && (
                        <p className="text-xs text-[var(--theme-muted)]">
                          Hint: {item.passwordHint}
                        </p>
                      )}
                      {item.error && (
                        <p className="mt-1 text-xs text-[var(--theme-danger)]">
                          {item.error}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input
                          type="password"
                          placeholder="Document password"
                          value={passwordDrafts[item.id] ?? ''}
                          onChange={(e) =>
                            setPasswordDrafts((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          className={inputClass}
                        />
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void submitPassword(item.id)}
                          className={buttonClass}
                        >
                          Unlock
                        </button>
                      </div>
                    </div>
                  )}

                  {item.status === 'awaiting_review' &&
                    item.documentClass === 'fd_certificate' && (
                      <div className="mt-2">
                        {item.error && !item.extractedFdCertificate && (
                          <p className="text-xs text-[var(--theme-warning)]">
                            Automatic FD-certificate extraction failed ({item.error}) — enter the deposit details manually below.
                          </p>
                        )}
                        {item.extractedFdCertificate && (
                          <span className={`mb-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${confidenceTone[item.extractedFdCertificate.confidence]}`}>
                            {item.extractedFdCertificate.confidence} confidence
                          </span>
                        )}
                        <div className="mb-2 rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] p-3 text-xs text-[var(--theme-muted)]">
                          <p className="font-semibold text-[var(--theme-text)]">FD certificate review</p>
                          <p className="mt-1">Confirming creates a fixed-deposit record. No funds are moved and auto-renew is stored as a preference only.</p>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <input type="text" placeholder="Bank name" defaultValue={item.extractedFdCertificate?.bankName} onChange={(e) => updateFdCertificateDraft(item.id, { bankName: e.target.value })} className={inputClass} />
                          <input type="text" placeholder="Certificate number (optional)" defaultValue={item.extractedFdCertificate?.certificateNumber} onChange={(e) => updateFdCertificateDraft(item.id, { certificateNumber: e.target.value })} className={inputClass} />
                          <input type="number" placeholder="Principal" defaultValue={item.extractedFdCertificate?.principal} onChange={(e) => updateFdCertificateDraft(item.id, { principal: Number(e.target.value) })} className={`${inputClass} w-32`} />
                          <input type="text" placeholder="Currency" defaultValue={item.extractedFdCertificate?.currency ?? 'LKR'} onChange={(e) => updateFdCertificateDraft(item.id, { currency: e.target.value })} className={`${inputClass} w-20`} />
                          <input type="number" min={0} step="0.01" placeholder="Rate % p.a." defaultValue={item.extractedFdCertificate?.interestRatePct} onChange={(e) => updateFdCertificateDraft(item.id, { interestRatePct: Number(e.target.value) })} className={`${inputClass} w-32`} />
                          <select value={(fdCertificateDrafts[item.id] ?? {}).interestPayout ?? item.extractedFdCertificate?.interestPayout ?? 'at_maturity'} onChange={(e) => updateFdCertificateDraft(item.id, { interestPayout: e.target.value as ExtractedFdCertificate['interestPayout'] })} className={inputClass}>
                            <option value="monthly">Monthly payout</option>
                            <option value="quarterly">Quarterly payout</option>
                            <option value="annually">Annual payout</option>
                            <option value="at_maturity">At maturity</option>
                          </select>
                          <input type="date" defaultValue={item.extractedFdCertificate?.startDate} onChange={(e) => updateFdCertificateDraft(item.id, { startDate: e.target.value })} className={inputClass} title="Start date" />
                          <input type="date" defaultValue={item.extractedFdCertificate?.maturityDate} onChange={(e) => updateFdCertificateDraft(item.id, { maturityDate: e.target.value })} className={inputClass} title="Maturity date" />
                          <label className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
                            <input type="checkbox" checked={(fdCertificateDrafts[item.id] ?? {}).autoRenew ?? item.extractedFdCertificate?.autoRenew ?? false} onChange={(e) => updateFdCertificateDraft(item.id, { autoRenew: e.target.checked })} />
                            Auto-renew preference
                          </label>
                        </div>
                      </div>
                    )}

                  {item.status === 'awaiting_review' &&
                    item.documentClass === 'fd_certificate' && (
                      <button type="button" disabled={busyId === item.id} onClick={() => void confirmFdCertificateItem(item)} className={confirmButtonClassLarge}>
                        Confirm fixed deposit
                      </button>
                    )}
                  {item.status === 'awaiting_review' &&
                    item.documentClass === 'contract_note' && (
                      <div className="mt-2">
                        {item.error && !item.extractedContractNote && (
                          <p className="text-xs text-[var(--theme-warning)]">
                            Automatic contract-note extraction failed ({item.error}) — enter the trade details manually below.
                          </p>
                        )}
                        {item.extractedContractNote && (
                          <span
                            className={`mb-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${confidenceTone[item.extractedContractNote.confidence]}`}
                          >
                            {item.extractedContractNote.confidence} confidence
                          </span>
                        )}
                        <div className="mb-2 rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] p-3 text-xs text-[var(--theme-muted)]">
                          <p className="font-semibold text-[var(--theme-text)]">Contract note review</p>
                          <p className="mt-1">Confirming creates an investment journal entry only. It does not create a holding, move cash, or execute a trade.</p>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <input
                            type="text"
                            placeholder="Symbol"
                            defaultValue={item.extractedContractNote?.symbol}
                            onChange={(e) => updateContractNoteDraft(item.id, { symbol: e.target.value })}
                            className={`${inputClass} w-28`}
                          />
                          <input
                            type="text"
                            placeholder="Company (optional)"
                            defaultValue={item.extractedContractNote?.companyName}
                            onChange={(e) => updateContractNoteDraft(item.id, { companyName: e.target.value })}
                            className={inputClass}
                          />
                          <select
                            value={(contractNoteDrafts[item.id] ?? {}).side ?? item.extractedContractNote?.side ?? 'buy'}
                            onChange={(e) => updateContractNoteDraft(item.id, { side: e.target.value as ExtractedContractNote['side'] })}
                            className={inputClass}
                          >
                            <option value="buy">Buy</option>
                            <option value="sell">Sell</option>
                          </select>
                          <input
                            type="number"
                            placeholder="Quantity"
                            defaultValue={item.extractedContractNote?.quantity}
                            onChange={(e) => updateContractNoteDraft(item.id, { quantity: Number(e.target.value) })}
                            className={`${inputClass} w-28`}
                          />
                          <input
                            type="number"
                            placeholder="Price"
                            defaultValue={item.extractedContractNote?.price}
                            onChange={(e) => updateContractNoteDraft(item.id, { price: Number(e.target.value) })}
                            className={`${inputClass} w-28`}
                          />
                          <input
                            type="text"
                            placeholder="Currency"
                            defaultValue={item.extractedContractNote?.currency ?? 'LKR'}
                            onChange={(e) => updateContractNoteDraft(item.id, { currency: e.target.value })}
                            className={`${inputClass} w-20`}
                          />
                          <input
                            type="date"
                            defaultValue={item.extractedContractNote?.tradeDate}
                            onChange={(e) => updateContractNoteDraft(item.id, { tradeDate: e.target.value })}
                            className={inputClass}
                            title="Trade date"
                          />
                          <input
                            type="date"
                            defaultValue={item.extractedContractNote?.settlementDate}
                            onChange={(e) => updateContractNoteDraft(item.id, { settlementDate: e.target.value })}
                            className={inputClass}
                            title="Settlement date"
                          />
                          <input
                            type="text"
                            placeholder="Broker (optional)"
                            defaultValue={item.extractedContractNote?.broker}
                            onChange={(e) => updateContractNoteDraft(item.id, { broker: e.target.value })}
                            className={inputClass}
                          />
                        </div>
                      </div>
                    )}

                  {item.status === 'awaiting_review' &&
                    item.documentClass === 'salary_slip' && (
                      <div className="mt-2">
                        {item.error && !item.extractedSalarySlip && (
                          <p className="text-xs text-[var(--theme-warning)]">
                            Automatic payroll extraction failed ({item.error}) — enter the details manually below.
                          </p>
                        )}
                        {item.extractedSalarySlip && (
                          <span
                            className={`mb-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${confidenceTone[item.extractedSalarySlip.confidence]}`}
                          >
                            {item.extractedSalarySlip.confidence} confidence
                          </span>
                        )}
                        <div className="mb-2 rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] p-3 text-xs text-[var(--theme-muted)]">
                          <p className="font-semibold text-[var(--theme-text)]">Salary slip review</p>
                          <p className="mt-1">Only the confirmed net pay becomes an income record. Gross pay and deductions remain explanatory notes.</p>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <input
                            type="text"
                            placeholder="Employer name"
                            defaultValue={item.extractedSalarySlip?.employerName}
                            onChange={(e) => updateSalarySlipDraft(item.id, { employerName: e.target.value })}
                            className={inputClass}
                          />
                          <input
                            type="text"
                            placeholder="Currency"
                            defaultValue={item.extractedSalarySlip?.currency ?? 'LKR'}
                            onChange={(e) => updateSalarySlipDraft(item.id, { currency: e.target.value })}
                            className={`${inputClass} w-20`}
                          />
                          <input
                            type="number"
                            placeholder="Net pay"
                            defaultValue={item.extractedSalarySlip?.netAmount}
                            onChange={(e) => updateSalarySlipDraft(item.id, { netAmount: Number(e.target.value) })}
                            className={`${inputClass} w-28`}
                          />
                          <input
                            type="number"
                            placeholder="Gross pay (optional)"
                            defaultValue={item.extractedSalarySlip?.grossAmount}
                            onChange={(e) => updateSalarySlipDraft(item.id, { grossAmount: e.target.value ? Number(e.target.value) : undefined })}
                            className={`${inputClass} w-36`}
                          />
                          <input
                            type="number"
                            placeholder="Deductions (optional)"
                            defaultValue={item.extractedSalarySlip?.deductions}
                            onChange={(e) => updateSalarySlipDraft(item.id, { deductions: e.target.value ? Number(e.target.value) : undefined })}
                            className={`${inputClass} w-40`}
                          />
                          <input
                            type="date"
                            defaultValue={item.extractedSalarySlip?.paymentDate}
                            onChange={(e) => updateSalarySlipDraft(item.id, { paymentDate: e.target.value })}
                            className={inputClass}
                            title="Payment date"
                          />
                          <input
                            type="text"
                            placeholder="Pay period (optional)"
                            defaultValue={item.extractedSalarySlip?.payPeriod}
                            onChange={(e) => updateSalarySlipDraft(item.id, { payPeriod: e.target.value })}
                            className={inputClass}
                          />
                        </div>
                      </div>
                    )}

                  {item.status === 'awaiting_review' &&
                    item.documentType === 'contract' && (
                      <div className="mt-2">
                        {item.error && !item.extractedContract && (
                          <p className="text-xs text-[var(--theme-warning)]">
                            Automatic extraction failed ({item.error}) — enter
                            the details manually below.
                          </p>
                        )}
                        {item.extractedContract && (
                          <span
                            className={`mb-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${confidenceTone[item.extractedContract.confidence]}`}
                          >
                            {item.extractedContract.confidence} confidence
                          </span>
                        )}
                        {item.extractedContract && (
                          <div className="mb-3 rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] p-3">
                            <p className="text-xs font-semibold text-[var(--theme-text)]">
                              AI contract review
                            </p>
                            <p className="mt-1 text-xs text-[var(--theme-muted)]">
                              {item.extractedContract.riskSummary}
                            </p>
                            {item.extractedContract.risks.length > 0 && (
                              <div className="mt-2 grid gap-1.5">
                                {item.extractedContract.risks.map((risk, i) => (
                                  <div
                                    key={i}
                                    className="flex flex-wrap items-start gap-2"
                                  >
                                    <span
                                      className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${severityTone[risk.severity]}`}
                                    >
                                      {risk.severity}
                                    </span>
                                    <span className="text-xs text-[var(--theme-muted)]">
                                      <strong className="text-[var(--theme-text)]">
                                        {risk.clause}:
                                      </strong>{' '}
                                      {risk.concern}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="mt-2 text-[10px] italic text-[var(--theme-muted)]">
                              AI-generated review — not legal advice; confirm
                              important terms yourself before signing or acting
                              on this.
                            </p>
                            {item.contractChanges && item.contractChanges.length > 0 && (
                              <div className="mt-3 rounded-lg border border-[var(--theme-warning)]/30 p-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-warning)]">
                                  Changes from the confirmed job
                                </p>
                                <div className="mt-1 grid gap-1">
                                  {item.contractChanges.map((change: ContractChange) => (
                                    <p key={change.field} className="text-[11px] text-[var(--theme-muted)]">
                                      <span className="font-medium text-[var(--theme-text)]">{change.field}:</span>{' '}
                                      {change.previous} → {change.current}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap gap-2">
                          <input
                            type="text"
                            placeholder="Employer name"
                            defaultValue={item.extractedContract?.employerName}
                            onChange={(e) =>
                              updateContractDraft(item.id, {
                                employerName: e.target.value,
                              })
                            }
                            className={inputClass}
                          />
                          <select
                            value={
                              (contractDrafts[item.id] ?? {}).employmentType ??
                              item.extractedContract?.employmentType ??
                              'other'
                            }
                            onChange={(e) =>
                              updateContractDraft(item.id, {
                                employmentType: e.target
                                  .value as ExtractedContract['employmentType'],
                              })
                            }
                            className={inputClass}
                          >
                            <option value="full_time">Full-time</option>
                            <option value="contract">Contract</option>
                            <option value="freelance">Freelance</option>
                            <option value="other">Other</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Job title (optional)"
                            defaultValue={item.extractedContract?.jobTitle}
                            onChange={(e) =>
                              updateContractDraft(item.id, {
                                jobTitle: e.target.value,
                              })
                            }
                            className={inputClass}
                          />
                          <input
                            type="number"
                            placeholder="Monthly amount (optional)"
                            defaultValue={
                              item.extractedContract?.monthlyIncomeAmount
                            }
                            onChange={(e) =>
                              updateContractDraft(item.id, {
                                monthlyIncomeAmount: Number(e.target.value),
                              })
                            }
                            className={`${inputClass} w-40`}
                          />
                          <input
                            type="text"
                            placeholder="Currency"
                            defaultValue={
                              item.extractedContract?.currency ?? 'LKR'
                            }
                            onChange={(e) =>
                              updateContractDraft(item.id, {
                                currency: e.target.value,
                              })
                            }
                            className={`${inputClass} w-20`}
                          />
                          <input
                            type="date"
                            defaultValue={
                              item.extractedContract?.contractStartDate
                            }
                            onChange={(e) =>
                              updateContractDraft(item.id, {
                                contractStartDate: e.target.value,
                              })
                            }
                            className={inputClass}
                            title="Contract start date"
                          />
                          <input
                            type="date"
                            defaultValue={
                              item.extractedContract?.contractEndDate
                            }
                            onChange={(e) =>
                              updateContractDraft(item.id, {
                                contractEndDate: e.target.value,
                              })
                            }
                            className={inputClass}
                            title="Contract end date"
                          />
                          <input
                            type="number"
                            min={1}
                            max={31}
                            placeholder="Payday (day, optional)"
                            defaultValue={
                              item.extractedContract?.paydayDayOfMonth
                            }
                            onChange={(e) =>
                              updateContractDraft(item.id, {
                                paydayDayOfMonth: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              })
                            }
                            className={`${inputClass} w-36`}
                            title="Expected day of month pay lands"
                          />
                        </div>
                        {item.extractedContract?.paySchedule && (
                          <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                            Pay schedule from contract:{' '}
                            {item.extractedContract.paySchedule}
                          </p>
                        )}
                        <div className="mt-2">
                          <select
                            value={targetJobDrafts[item.id] ?? ''}
                            onChange={(e) =>
                              setTargetJobDrafts((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            className={inputClass}
                          >
                            <option value="">Create new job</option>
                            {payload.data.income_sources.map((job) => {
                              const jobId =
                                typeof job.id === 'string' ? job.id : ''
                              const employerName =
                                typeof job.employerName === 'string'
                                  ? job.employerName
                                  : 'Job'
                              return (
                                <option key={jobId} value={jobId}>
                                  Update existing job: {employerName}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                      </div>
                    )}

                  {item.status === 'awaiting_review' &&
                    item.documentClass === 'contract_note' && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void confirmContractNoteItem(item)}
                        className={confirmButtonClassLarge}
                      >
                        Confirm journal entry
                      </button>
                    )}
                  {item.status === 'awaiting_review' &&
                    item.documentClass === 'salary_slip' && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void confirmSalarySlipItem(item)}
                        className={confirmButtonClassLarge}
                      >
                        Confirm income
                      </button>
                    )}
                  {item.status === 'awaiting_review' &&
                    item.documentClass !== 'salary_slip' &&
                    item.documentClass !== 'contract_note' &&
                    item.documentClass !== 'fd_certificate' &&
                    item.documentType !== 'contract' && (
                      <div className="mt-2">
                        {item.error && !item.extracted && (
                          <p className="text-xs text-[var(--theme-warning)]">
                            Automatic extraction failed ({item.error}) — enter
                            the details manually below.
                          </p>
                        )}
                        {item.extracted && (
                          <span
                            className={`mb-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${confidenceTone[item.extracted.confidence]}`}
                          >
                            {item.extracted.confidence} confidence
                          </span>
                        )}
                        <div className="mt-1 flex flex-wrap gap-2">
                          <select
                            value={
                              (editDrafts[item.id] ?? {}).kind ??
                              item.extracted?.kind ??
                              'expense'
                            }
                            onChange={(e) =>
                              updateDraft(item.id, {
                                kind: e.target.value as 'income' | 'expense',
                              })
                            }
                            className={inputClass}
                          >
                            <option value="expense">Expense</option>
                            <option value="income">Income</option>
                          </select>
                          <input
                            type="number"
                            placeholder="Amount"
                            defaultValue={item.extracted?.amount}
                            onChange={(e) =>
                              updateDraft(item.id, {
                                amount: Number(e.target.value),
                              })
                            }
                            className={`${inputClass} w-28`}
                          />
                          <input
                            type="text"
                            placeholder="Currency"
                            defaultValue={item.extracted?.currency ?? 'LKR'}
                            onChange={(e) =>
                              updateDraft(item.id, { currency: e.target.value })
                            }
                            className={`${inputClass} w-20`}
                          />
                          <input
                            type="text"
                            placeholder="Vendor / source"
                            defaultValue={item.extracted?.vendorOrSource}
                            onChange={(e) =>
                              updateDraft(item.id, {
                                vendorOrSource: e.target.value,
                              })
                            }
                            className={inputClass}
                          />
                          <input
                            type="date"
                            defaultValue={item.extracted?.date}
                            onChange={(e) =>
                              updateDraft(item.id, { date: e.target.value })
                            }
                            className={inputClass}
                          />
                          <input
                            type="text"
                            placeholder={
                              item.extracted?.kind === 'expense' &&
                              !item.extracted.category?.trim()
                                ? 'Category required'
                                : 'Category'
                            }
                            defaultValue={item.extracted?.category}
                            onChange={(e) =>
                              updateDraft(item.id, { category: e.target.value })
                            }
                            className={`${inputClass} ${item.extracted?.kind === 'expense' && !item.extracted.category?.trim() ? 'border-[var(--theme-warning)]' : ''}`}
                          />
                        </div>
                        {hasDuplicateWarning && (
                          <p className="mt-2 text-xs text-[var(--theme-warning)]">
                            Possible duplicate: an existing record for "
                            {duplicateWarning.vendorOrSource}" on{' '}
                            {duplicateWarning.date} for{' '}
                            {duplicateWarning.amount} already exists.
                          </p>
                        )}
                      </div>
                    )}
                </div>

                <div className="flex gap-2">
                  {item.status === 'awaiting_review' &&
                    item.documentType === 'contract' && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void confirmContractItem(item)}
                        className={confirmButtonClassLarge}
                      >
                        Confirm
                      </button>
                    )}
                  {item.status === 'awaiting_review' &&
                    item.documentClass !== 'salary_slip' &&
                    item.documentClass !== 'contract_note' &&
                    item.documentClass !== 'fd_certificate' &&
                    item.documentType !== 'contract' && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() =>
                          void confirmItem(item, hasDuplicateWarning)
                        }
                        className={confirmButtonClassLarge}
                      >
                        {hasDuplicateWarning ? 'Confirm anyway' : 'Confirm'}
                      </button>
                    )}
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void reject(item.id)}
                    className={dangerButtonClassLarge}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )
          })}
            </div>
          )}
        </>
      )}

      {historyItems.length > 0 && (
        <div className="mt-5 rounded-2xl border border-[var(--theme-border)]/70 p-3">
          <h3 className="text-sm font-semibold">Document history</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Confirmed and rejected intake records. File paths and document contents stay private.
          </p>
          <div className="mt-2 grid gap-1">
            {historyItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] px-3 py-2 text-xs"
              >
                <span>
                  <span className="font-medium">{item.documentType}</span> · {item.source}
                  {item.documentClass && item.documentClass !== 'unknown'
                    ? ` · ${item.documentClass.replaceAll('_', ' ')}`
                    : ''}
                  {item.extracted?.vendorOrSource
                    ? ` · ${item.extracted.vendorOrSource}`
                    : item.extractedContract?.employerName
                      ? ` · ${item.extractedContract.employerName}`
                      : ''}
                </span>
                <span className="text-[var(--theme-muted)]">
                  {item.status.replace('_', ' ')} ·{' '}
                  {item.updatedAt || item.createdAt
                    ? formatDateTime(item.updatedAt ?? item.createdAt ?? '')
                    : 'date unavailable'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
