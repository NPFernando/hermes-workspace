import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buttonClass,
  confirmButtonClassLarge,
  dangerButtonClassLarge,
  dangerTone,
  infoTone,
  inputClass,
  positiveTone,
  warningTone,
} from '../shared-styles'
import type {
  ExtractedContract,
  ExtractedTransaction,
  IngestionAutoRule,
  PendingIngestion,
  PersonalFinancePayload,
} from '../types'

type DuplicateWarning = {
  date: string
  amount: number
  vendorOrSource: string
  confidence: 'exact' | 'likely' | 'possible'
}

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

/** AI-307: rank items needing the most attention first — missing confidence (extraction failed) ranks with 'low'. */
function confidenceRank(item: PendingIngestion): number {
  const confidence =
    item.extracted?.confidence ?? item.extractedContract?.confidence
  if (confidence === 'high') return 2
  if (confidence === 'medium') return 1
  return 0
}

type GmailSyncRun = {
  at: number
  found: number
  queued: number
  skippedAlreadyQueued: number
  autoConfirmed?: number
  duplicates?: number
  deferred?: number
}

type SweepResult = { duplicates: number; autoConfirmed: number }

/** Gmail items from an identifiable sender can become an auto rule. */
function canCreateRule(item: PendingIngestion): boolean {
  return (
    item.source === 'gmail' &&
    item.documentType !== 'contract' &&
    Boolean(item.senderAddress || item.matchedSenderId)
  )
}

function senderName(item: PendingIngestion): string {
  return item.matchedSenderLabel || item.senderAddress || 'this sender'
}

function money(e: ExtractedTransaction | undefined): string {
  if (!e) return ''
  return `${e.currency} ${e.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function syncSummary(r: GmailSyncRun): string {
  const parts = [`found ${r.found}`, `queued ${r.queued}`]
  if (r.autoConfirmed) parts.push(`auto-added ${r.autoConfirmed}`)
  if (r.duplicates) parts.push(`${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} hidden`)
  if (r.deferred) parts.push(`${r.deferred} left for next sync`)
  return parts.join(', ')
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
  const [allItems, setAllItems] = useState<Array<PendingIngestion>>([])
  const [rules, setRules] = useState<Array<IngestionAutoRule>>([])
  // Per-item "record this sender automatically" choice; default on.
  const [ruleOptOut, setRuleOptOut] = useState<Record<string, boolean>>({})
  const items = useMemo(
    () =>
      allItems.filter(
        (p) =>
          p.status === 'awaiting_password' || p.status === 'awaiting_review',
      ),
    [allItems],
  )
  const duplicates = useMemo(
    () => allItems.filter((p) => p.status === 'duplicate'),
    [allItems],
  )
  const autoAdded = useMemo(
    () =>
      allItems
        .filter((p) => p.status === 'auto_confirmed')
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, 10),
    [allItems],
  )
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => confidenceRank(a) - confidenceRank(b)),
    [items],
  )
  const [uploading, setUploading] = useState(false)
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
  const [targetJobDrafts, setTargetJobDrafts] = useState<
    Record<string, string>
  >({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailLastSyncedAtSeconds, setGmailLastSyncedAtSeconds] = useState<
    number | null
  >(null)
  const [gmailSyncHistory, setGmailSyncHistory] = useState<
    Array<GmailSyncRun>
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
  const contractFileInputRef = useRef<HTMLInputElement | null>(null)

  const checkGmailConnection = useCallback(() => {
    return fetch('/api/auth/gmail-connect?check=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then(
        (data: {
          connected?: boolean
          lastSyncedAtSeconds?: number | null
          syncHistory?: Array<GmailSyncRun>
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

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch('/api/finance?scope=personal_finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as Record<string, unknown> & {
      ok?: boolean
      error?: string
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [queue, ruleList] = await Promise.all([
        post({ action: 'list_pending_ingestions' }),
        post({ action: 'list_ingestion_rules' }),
      ])
      if (queue.ok)
        setAllItems(
          (queue.pendingIngestions as Array<PendingIngestion> | undefined) ??
            [],
        )
      if (ruleList.ok)
        setRules((ruleList.rules as Array<IngestionAutoRule> | undefined) ?? [])
    } catch {
      /* transient */
    }
  }, [post])

  async function runAction(
    id: string,
    body: Record<string, unknown>,
    fallbackError: string,
  ) {
    setBusyId(id)
    setNote(null)
    try {
      const data = await post(body)
      if (data.ok === false) setNote(data.error || fallbackError)
      else if (body.action === 'undo_auto_ingestion')
        onConfirmed(data as unknown as PersonalFinancePayload)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : fallbackError)
    } finally {
      setBusyId(null)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  async function syncGmail() {
    setSyncing(true)
    setNote(null)
    try {
      const res = await fetch('/api/finance?scope=personal_finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync_gmail_now' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        result?: GmailSyncRun
      }
      if (!data.ok) setNote(data.error || 'Gmail sync failed')
      else if (data.result) setNote(`Gmail sync: ${syncSummary(data.result)}.`)
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
    documentType: 'transaction' | 'contract' = 'transaction',
  ) {
    const setBusy =
      documentType === 'contract' ? setUploadingContract : setUploading
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
      if (contractFileInputRef.current) contractFileInputRef.current.value = ''
    }
  }

  async function submitPassword(id: string) {
    const password = (passwordDrafts[id] ?? '').trim()
    if (!password) return
    setBusyId(id)
    try {
      const res = await fetch('/api/finance?scope=personal_finance', {
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
      await fetch('/api/finance?scope=personal_finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reject_pending_ingestion', id }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  // For a transient extraction failure (e.g. every vision route
  // rate-limited at once — confirmed live 2026-09-11) rather than the
  // document itself being unreadable. Reuses the already-converted preview
  // image, so this doesn't need the original password again.
  async function retryExtraction(id: string) {
    setBusyId(id)
    setNote(null)
    try {
      const res = await fetch('/api/finance?scope=personal_finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'retry_pending_extraction', id }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Retry failed')
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
      const res = await fetch('/api/finance?scope=personal_finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_pending_ingestion',
          id: item.id,
          payload: draft,
          force,
          autoRule: canCreateRule(item) && !ruleOptOut[item.id],
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        duplicateWarning?: {
          date: string
          amount: number
          vendorOrSource: string
          confidence: 'exact' | 'likely' | 'possible'
        }
        autoRule?: IngestionAutoRule | null
        sweep?: SweepResult
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
      onConfirmed(data as unknown as PersonalFinancePayload)
      const settled = data.sweep
        ? data.sweep.autoConfirmed + data.sweep.duplicates
        : 0
      if (data.autoRule || settled > 0)
        setNote(
          [
            data.autoRule
              ? `Future bills from ${data.autoRule.label} will be recorded automatically.`
              : '',
            settled > 0
              ? `${data.sweep!.autoConfirmed} more added automatically, ${data.sweep!.duplicates} duplicate${data.sweep!.duplicates === 1 ? '' : 's'} hidden.`
              : '',
          ]
            .filter(Boolean)
            .join(' '),
        )
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusyId(null)
    }
  }

  function updateDraft(id: string, patch: Partial<ExtractedTransaction>) {
    setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function updateContractDraft(id: string, patch: Partial<ExtractedContract>) {
    setContractDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
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
      const res = await fetch('/api/finance?scope=personal_finance', {
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
            ? `Last synced ${new Date(gmailLastSyncedAtSeconds * 1000).toLocaleString()}`
            : 'Never synced'}
        </p>
      )}

      {gmailConnected && gmailSyncHistory.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--theme-muted)]">
          {[...gmailSyncHistory].reverse().map((run) => (
            <span key={run.at}>
              {new Date(run.at * 1000).toLocaleDateString()}: {syncSummary(run)}
            </span>
          ))}
        </div>
      )}

      {note && (
        <p className="mt-2 text-xs text-[var(--theme-danger)]">{note}</p>
      )}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          Nothing to review
          {autoAdded.length + duplicates.length > 0
            ? '.'
            : ' — upload a receipt or bill to try it.'}
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {sortedItems.map((item) => {
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
                    {item.matchedSenderLabel && (
                      <>
                        <span>·</span>
                        <span
                          className={`rounded-lg border px-1.5 py-0.5 text-[10px] ${infoTone}`}
                        >
                          {item.matchedSenderLabel}
                        </span>
                      </>
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
                            placeholder="Category"
                            defaultValue={item.extracted?.category}
                            onChange={(e) =>
                              updateDraft(item.id, { category: e.target.value })
                            }
                            className={inputClass}
                          />
                        </div>
                        {hasDuplicateWarning && (
                          <p className="mt-2 text-xs text-[var(--theme-warning)]">
                            {duplicateWarning.confidence === 'possible'
                              ? 'Possible duplicate (vendor name is a close typo match): an'
                              : duplicateWarning.confidence === 'exact'
                                ? 'Possible duplicate: an'
                                : 'Possible duplicate (close match, different day): an'}{' '}
                            existing record for "
                            {duplicateWarning.vendorOrSource}" on{' '}
                            {duplicateWarning.date} for{' '}
                            {duplicateWarning.amount} already exists.
                          </p>
                        )}
                        {canCreateRule(item) && (
                          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--theme-muted)]">
                            <input
                              type="checkbox"
                              checked={!ruleOptOut[item.id]}
                              onChange={(e) =>
                                setRuleOptOut((prev) => ({
                                  ...prev,
                                  [item.id]: !e.target.checked,
                                }))
                              }
                            />
                            Record future bills from {senderName(item)}{' '}
                            automatically
                          </label>
                        )}
                      </div>
                    )}
                </div>

                <div className="flex gap-2">
                  {item.status === 'awaiting_review' &&
                    item.error &&
                    item.rawPreviewImagePath && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void retryExtraction(item.id)}
                        className={buttonClass}
                      >
                        Retry extraction
                      </button>
                    )}
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

      {autoAdded.length > 0 && (
        <div className="mt-5" data-testid="auto-added">
          <h3 className="text-sm font-semibold">Added automatically by your rules</h3>
          <ul className="mt-2 grid gap-1.5">
            {autoAdded.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--theme-border)]/60 px-3 py-1.5 text-xs"
              >
                <span>
                  {item.extracted?.date} · {item.extracted?.vendorOrSource} ·{' '}
                  {money(item.extracted)}
                </span>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() =>
                    void runAction(
                      item.id,
                      { action: 'undo_auto_ingestion', id: item.id },
                      'Undo failed',
                    )
                  }
                  className={buttonClass}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
            Undo removes the record, returns the item for review, and pauses
            that sender's rule.
          </p>
        </div>
      )}

      {duplicates.length > 0 && (
        <details className="mt-4 text-xs" data-testid="duplicates">
          <summary className="cursor-pointer text-[var(--theme-muted)]">
            {duplicates.length} duplicate{duplicates.length === 1 ? '' : 's'}{' '}
            hidden (same bill already recorded or queued)
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {duplicates.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--theme-border)]/60 px-3 py-1.5"
              >
                <span>
                  {item.extracted?.date} · {item.extracted?.vendorOrSource} ·{' '}
                  {money(item.extracted)}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() =>
                      void runAction(
                        item.id,
                        { action: 'restore_duplicate_ingestion', id: item.id },
                        'Restore failed',
                      )
                    }
                    className={buttonClass}
                  >
                    Not a duplicate
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() =>
                      void runAction(
                        item.id,
                        { action: 'reject_pending_ingestion', id: item.id },
                        'Dismiss failed',
                      )
                    }
                    className={buttonClass}
                  >
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {rules.length > 0 && (
        <div className="mt-5" data-testid="auto-rules">
          <h3 className="text-sm font-semibold">Automatic recording rules</h3>
          <p className="text-[10px] text-[var(--theme-muted)]">
            Bills from these senders are recorded without review when the
            amount looks normal (up to 3× the largest one you approved).
            Anything unusual still comes here first.
          </p>
          <ul className="mt-2 grid gap-1.5">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--theme-border)]/60 px-3 py-1.5 text-xs"
              >
                <span>
                  {rule.label} → {rule.kind} “{rule.vendorOrSource}”
                  {rule.category ? ` (${rule.category})` : ''} · used{' '}
                  {rule.matchCount}×{rule.enabled ? '' : ' · paused'}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === rule.id}
                    onClick={() =>
                      void runAction(
                        rule.id,
                        {
                          action: 'set_ingestion_rule_enabled',
                          id: rule.id,
                          enabled: !rule.enabled,
                        },
                        'Rule update failed',
                      )
                    }
                    className={buttonClass}
                  >
                    {rule.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === rule.id}
                    onClick={() =>
                      void runAction(
                        rule.id,
                        { action: 'delete_ingestion_rule', id: rule.id },
                        'Rule delete failed',
                      )
                    }
                    className={buttonClass}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
