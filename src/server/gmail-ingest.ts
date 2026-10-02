/**
 * Gmail sync — "Sync now" plus the hourly Hermes cron (gmail-sync.sh).
 * Every message in the lookback window that has not been examined yet is
 * processed once (settings.gmailIngest.processedMessageIds), within a
 * per-run extraction budget; the rest wait for the next run. Each extracted
 * item then goes through ingestion-rules.ts (duplicates hidden, approved
 * senders recorded automatically). Lists messages via the Gmail API using the
 * connect-flow refresh token (google-oauth.ts), pre-filters by a Gmail
 * search query before spending any LLM call, downloads attachments to the
 * same directory direct uploads use, and lands everything as a
 * pending_ingestion — same review queue as finance-upload.ts, so the UI
 * doesn't need to know which path an item came from.
 *
 * The search query is the generic keyword group OR'd with `from:` clauses
 * built from the user's registered settings.gmailIngest.knownSenders (see
 * finance-store.ts) — this repo never hardcodes real bank/biller domains;
 * they live in Postgres settings, populated by the user via
 * upsert_known_sender. Falls back to the keyword group alone when no
 * known senders are registered yet.
 *
 * For a password-protected PDF from a *known* sender with a stored
 * password (explicit user opt-in via set_known_sender_password — see
 * secret-crypto.ts), this tries that one registered secret before queueing
 * for manual review. It still never guesses a password from body text —
 * `findPasswordHint` remains the fallback hint shown when there's no known
 * sender match, or the known sender has no password stored, or the stored
 * password doesn't work.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getGmailAccessToken } from './google-oauth'
import {
  FINANCE_INGESTION_UPLOAD_DIR,
  addPendingIngestion,
  decryptKnownSenderPassword,
  getCategoryCorrections,
  listKnownSenders,
  listPendingIngestions,
  readFinanceStore,
  updatePendingIngestion,
  writeFinanceStore,
} from './finance-store'
import { applyIngestionPolicies } from './ingestion-rules'
import { isPdfEncrypted, pdfToImages } from './document-normalizer'
import {
  extractTransactionFromImage,
  extractTransactionFromText,
} from './finance-extraction'
import type { KnownSender } from './finance-store'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// Cheap keyword pre-filter before any LLM call — avoids burning quota
// classifying newsletters, OTPs, and everything else in the inbox. OR'd
// with known-sender `from:` clauses at query-build time (see buildSearchQuery).
const KEYWORD_GROUP =
  '(invoice OR receipt OR bill OR statement OR payment OR salary OR "payment received" OR "amount due") -category:promotions -category:social'

const MAX_PAGES = 10
const PAGE_SIZE = 50

export function buildSearchQuery(knownSenders: Array<KnownSender>, afterSeconds: number): string {
  const senderClauses = knownSenders
    .map((s) => (s.matchAddress ? `from:${s.matchAddress}` : s.matchDomain ? `from:${s.matchDomain}` : null))
    .filter((clause): clause is string => Boolean(clause))
  const group =
    senderClauses.length > 0
      ? `(${KEYWORD_GROUP}) OR (${senderClauses.join(' OR ')})`
      : KEYWORD_GROUP
  return `${group} after:${afterSeconds}`
}

/** Pulls the bare email address out of a From header ("Name <addr>" or a
 *  bare address) — undefined if nothing address-shaped is found. Used to
 *  stamp senderAddress on every pending_ingestion so unmatched-but-repeat
 *  senders can be surfaced as registration candidates later. */
export function extractSenderAddress(fromHeader: string): string | undefined {
  const angleMatch = fromHeader.match(/<([^<>]+)>/)
  const candidate = (angleMatch ? angleMatch[1] : fromHeader).trim().toLowerCase()
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate)
    ? candidate
    : undefined
}

/** Matches the message's From header against registered known senders — domain match first, exact address as a tiebreaker. */
export function matchKnownSender(
  fromHeader: string,
  knownSenders: Array<KnownSender>,
): KnownSender | undefined {
  const lower = fromHeader.toLowerCase()
  return knownSenders.find(
    (s) =>
      (s.matchAddress && lower.includes(s.matchAddress)) ||
      (s.matchDomain && lower.includes(s.matchDomain.toLowerCase())),
  )
}

interface GmailMessagePart {
  mimeType?: string
  filename?: string
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: Array<GmailMessagePart>
}

interface GmailMessageHeader {
  name: string
  value: string
}

interface GmailMessage {
  id: string
  payload?: GmailMessagePart & { headers?: Array<GmailMessageHeader> }
}

function findHeader(message: GmailMessage, name: string): string {
  const header = message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  )
  return header?.value ?? ''
}

async function gmailFetch(url: string, accessToken: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
}

function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function findPlainTextBody(part: GmailMessagePart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data).toString('utf-8')
  }
  for (const child of part.parts ?? []) {
    const found = findPlainTextBody(child)
    if (found) return found
  }
  // Fall back to text/html only if no plain-text part exists anywhere.
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .toString('utf-8')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return ''
}

function findAttachments(
  part: GmailMessagePart | undefined,
): Array<{ filename: string; attachmentId: string; mimeType: string }> {
  if (!part) return []
  const results: Array<{
    filename: string
    attachmentId: string
    mimeType: string
  }> = []
  if (part.filename && part.body?.attachmentId) {
    results.push({
      filename: part.filename,
      attachmentId: part.body.attachmentId,
      mimeType: part.mimeType ?? '',
    })
  }
  for (const child of part.parts ?? []) {
    results.push(...findAttachments(child))
  }
  return results
}

function findPasswordHint(bodyText: string): string | undefined {
  const sentences = bodyText.split(/(?<=[.!?\n])\s+/)
  const hintSentence = sentences.find((s) => /password|pwd/i.test(s))
  return hintSentence?.trim().slice(0, 300)
}

async function downloadAttachment(
  messageId: string,
  attachmentId: string,
  filename: string,
  accessToken: string,
): Promise<string> {
  const res = await gmailFetch(
    `${GMAIL_API}/messages/${messageId}/attachments/${attachmentId}`,
    accessToken,
  )
  if (!res.ok) throw new Error(`Failed to download attachment: ${res.status}`)
  const data = (await res.json()) as { data: string }
  fs.mkdirSync(FINANCE_INGESTION_UPLOAD_DIR, { recursive: true, mode: 0o700 })
  const ext = path.extname(filename) || '.bin'
  const savedPath = path.join(
    FINANCE_INGESTION_UPLOAD_DIR,
    `gmail-${messageId}-${randomUUID()}${ext}`,
  )
  fs.writeFileSync(savedPath, decodeBase64Url(data.data), { mode: 0o600 })
  return savedPath
}

function alreadyQueued(messageId: string): boolean {
  return listPendingIngestions().some(
    (p) =>
      p.source === 'gmail' &&
      (p.gmailMessageId === messageId ||
        p.sourceRef === `gmail:${messageId}` ||
        p.sourceRef.includes(`gmail-${messageId}-`)),
  )
}

/** Text-only emails without anything amount-shaped are not bills — skip them
 *  without spending an extraction call. Deliberately loose. */
export function looksLikeItHasAnAmount(text: string): boolean {
  return /\d[\d,]*\.\d{2}\b|\b(?:rs|lkr|usd|eur|gbp|aud|inr)\.?\s*[\d,]+|[$€£₹]\s?[\d,]+|\b(?:amount|total|due|balance|paid)\b[^\n\d]{0,20}\d/i.test(
    text,
  )
}

export interface GmailSyncResult {
  found: number
  queued: number
  skippedAlreadyQueued: number
  /** Recorded automatically by an approved sender rule. */
  autoConfirmed: number
  /** Hidden as a repeat of a bill already recorded or queued. */
  duplicates: number
  /** Failed extractions retried this run (no Gmail call needed). */
  retried: number
  /** Messages left for the next run because the per-run extraction budget ran out. */
  deferred: number
}

const DEFAULT_LOOKBACK_DAYS = 90
const DEFAULT_MAX_EXTRACTIONS_PER_RUN = 25
const MAX_EXTRACTION_RETRIES = 3
const PROCESSED_LEDGER_CAP = 5000
// Transient failures worth retrying; anything else (unreadable document,
// "no transaction found") is final.
const RETRYABLE_ERRORS = new Set(['all_routes_failed'])

function numberSetting(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

let runningSync: Promise<GmailSyncResult> | null = null

/** Overlapping calls (hourly cron + a "Sync now" click) share one run. */
export function syncGmailNow(): Promise<GmailSyncResult> {
  if (!runningSync) {
    runningSync = runGmailSync().finally(() => {
      runningSync = null
    })
  }
  return runningSync
}

async function runGmailSync(): Promise<GmailSyncResult> {
  const startSettings = readFinanceStore().settings as Record<string, unknown>
  const startIngest = (
    startSettings.gmailIngest && typeof startSettings.gmailIngest === 'object'
      ? startSettings.gmailIngest
      : {}
  ) as Record<string, unknown>
  const lastSyncedAtSeconds =
    typeof startIngest.lastSyncedAtSeconds === 'number'
      ? startIngest.lastSyncedAtSeconds
      : 0
  const lookbackDays = numberSetting(startIngest.lookbackDays, DEFAULT_LOOKBACK_DAYS)
  let budget = numberSetting(
    startIngest.maxExtractionsPerRun,
    DEFAULT_MAX_EXTRACTIONS_PER_RUN,
  )
  const processed = new Set<string>(
    Array.isArray(startIngest.processedMessageIds)
      ? (startIngest.processedMessageIds as Array<unknown>).filter(
          (v): v is string => typeof v === 'string',
        )
      : [],
  )
  const newlyProcessed: Array<string> = []
  const markProcessed = (id: string) => {
    if (!processed.has(id)) {
      processed.add(id)
      newlyProcessed.push(id)
    }
  }

  let queued = 0
  let skippedAlreadyQueued = 0
  let autoConfirmed = 0
  let duplicates = 0
  let retried = 0
  let deferred = 0
  const categoryHints = getCategoryCorrections()

  const applyPolicies = (id: string) => {
    const outcome = applyIngestionPolicies(id)
    if (outcome === 'auto_confirmed') autoConfirmed += 1
    if (outcome === 'duplicate') duplicates += 1
  }
  const queue = (input: Parameters<typeof addPendingIngestion>[0]) => {
    const record = addPendingIngestion(input)
    queued += 1
    if (record.extracted) applyPolicies(record.id)
  }

  // 1. Retry transient extraction failures from earlier runs first — these
  //    only need the saved preview image, so they still happen while the
  //    Gmail token is expired.
  for (const item of listPendingIngestions()) {
    if (budget <= 0) break
    if (
      item.source !== 'gmail' ||
      item.status !== 'awaiting_review' ||
      item.documentType === 'contract' ||
      item.extracted ||
      !item.rawPreviewImagePath ||
      !item.error ||
      !RETRYABLE_ERRORS.has(item.error) ||
      (item.extractionRetries ?? 0) >= MAX_EXTRACTION_RETRIES
    )
      continue
    budget -= 1
    retried += 1
    const extraction = await extractTransactionFromImage(
      item.rawPreviewImagePath,
      categoryHints,
    )
    updatePendingIngestion(item.id, {
      extracted: extraction.ok ? extraction.data : undefined,
      error: extraction.ok ? undefined : extraction.reason,
      extractionRetries: (item.extractionRetries ?? 0) + 1,
    })
    if (extraction.ok) applyPolicies(item.id)
  }

  const accessToken = await getGmailAccessToken()

  // 2. Every message in the lookback window that has not been examined yet —
  //    not just mail newer than the last sync, so nothing missed while the
  //    token was expired (or deferred by the budget) is lost.
  const nowSeconds = Math.floor(Date.now() / 1000)
  const windowStart = nowSeconds - lookbackDays * 24 * 60 * 60
  const afterSeconds = lastSyncedAtSeconds
    ? Math.min(lastSyncedAtSeconds, windowStart)
    : windowStart
  const knownSenders = listKnownSenders()
  const query = buildSearchQuery(knownSenders, afterSeconds)

  const messageIds: Array<string> = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const pageParam = pageToken ? `&pageToken=${pageToken}` : ''
    const listRes = await gmailFetch(
      `${GMAIL_API}/messages?maxResults=${PAGE_SIZE}&q=${encodeURIComponent(query)}${pageParam}`,
      accessToken,
    )
    if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`)
    const listData = (await listRes.json()) as {
      messages?: Array<{ id: string }>
      nextPageToken?: string
    }
    messageIds.push(...(listData.messages ?? []).map((m) => m.id))
    if (!listData.nextPageToken) break
    pageToken = listData.nextPageToken
  }

  for (const messageId of messageIds) {
    if (processed.has(messageId)) {
      skippedAlreadyQueued += 1
      continue
    }
    if (alreadyQueued(messageId)) {
      markProcessed(messageId)
      skippedAlreadyQueued += 1
      continue
    }
    if (budget <= 0) {
      deferred += 1
      continue
    }

    const msgRes = await gmailFetch(
      `${GMAIL_API}/messages/${messageId}?format=full`,
      accessToken,
    )
    if (!msgRes.ok) continue
    const message = (await msgRes.json()) as GmailMessage
    const bodyText = findPlainTextBody(message.payload)
    const fromHeader = findHeader(message, 'From')
    const matchedSender = matchKnownSender(fromHeader, knownSenders)
    const senderAddress = extractSenderAddress(fromHeader)
    const attachments = findAttachments(message.payload).filter(
      (a) =>
        a.mimeType === 'application/pdf' || a.mimeType.startsWith('image/'),
    )
    const base = {
      source: 'gmail' as const,
      gmailMessageId: messageId,
      matchedSenderId: matchedSender?.id,
      matchedSenderLabel: matchedSender?.label,
      senderAddress,
    }

    if (attachments.length === 0) {
      if (!bodyText.trim() || !looksLikeItHasAnAmount(bodyText)) {
        markProcessed(messageId)
        continue
      }
      budget -= 1
      const extraction = await extractTransactionFromText(
        bodyText,
        categoryHints,
      )
      if (!extraction.ok) {
        // A transient failure is retried next run; "no transaction" is final.
        if (!RETRYABLE_ERRORS.has(extraction.reason)) markProcessed(messageId)
        continue
      }
      queue({
        ...base,
        sourceRef: `gmail:${messageId}`,
        status: 'awaiting_review',
        extracted: extraction.data,
      })
      markProcessed(messageId)
      continue
    }

    // One attachment per email is the common case (bill/receipt PDF); handle the first one.
    const attachment = attachments[0]
    const savedPath = await downloadAttachment(
      messageId,
      attachment.attachmentId,
      attachment.filename,
      accessToken,
    )
    markProcessed(messageId)

    const isPdf = savedPath.toLowerCase().endsWith('.pdf')
    let unlockedPassword: string | undefined
    if (isPdf && isPdfEncrypted(savedPath)) {
      // Try the one password the user explicitly registered for this
      // sender (if any) before falling into the manual review queue —
      // still not a guess, since it's a secret the user set on purpose.
      const storedPassword = matchedSender
        ? decryptKnownSenderPassword(matchedSender)
        : undefined
      if (storedPassword) {
        const attempt = pdfToImages(savedPath, storedPassword)
        if (attempt.ok) {
          unlockedPassword = storedPassword
        }
      }
      if (!unlockedPassword) {
        queue({
          ...base,
          sourceRef: savedPath,
          status: 'awaiting_password',
          passwordHint: matchedSender?.passwordScheme ?? findPasswordHint(bodyText),
        })
        continue
      }
    }

    let previewImagePath = savedPath
    if (isPdf) {
      const normalized = pdfToImages(savedPath, unlockedPassword)
      if (!normalized.ok) {
        queue({
          ...base,
          sourceRef: savedPath,
          status: 'awaiting_review',
          error: `Could not process document: ${normalized.reason}`,
        })
        continue
      }
      previewImagePath = normalized.imagePaths[0]
    }

    budget -= 1
    const extraction = await extractTransactionFromImage(
      previewImagePath,
      categoryHints,
    )
    queue({
      ...base,
      sourceRef: savedPath,
      status: 'awaiting_review',
      rawPreviewImagePath: previewImagePath,
      extracted: extraction.ok ? extraction.data : undefined,
      error: extraction.ok ? undefined : extraction.reason,
    })
  }

  const now = Math.floor(Date.now() / 1000)
  const summary = {
    found: messageIds.length,
    queued,
    skippedAlreadyQueued,
    autoConfirmed,
    duplicates,
    retried,
    deferred,
  }
  // Re-read and merge only the keys this run owns: every addPendingIngestion
  // / rule update above did its own read/write, and the user may have edited
  // known senders or rules mid-run — writing back the object captured at the
  // start would clobber all of that (a real bug, 2026-09-11, for the queue).
  const freshDb = readFinanceStore()
  const freshSettings = freshDb.settings as Record<string, unknown>
  const gmailIngest = (
    freshSettings.gmailIngest && typeof freshSettings.gmailIngest === 'object'
      ? { ...(freshSettings.gmailIngest as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>
  gmailIngest.lastSyncedAtSeconds = now
  // A run that got this far succeeded — clear any stale "reconnect needed" flag.
  delete gmailIngest.lastError
  const freshLedger = Array.isArray(gmailIngest.processedMessageIds)
    ? (gmailIngest.processedMessageIds as Array<string>)
    : []
  gmailIngest.processedMessageIds = Array.from(
    new Set([...freshLedger, ...newlyProcessed]),
  ).slice(-PROCESSED_LEDGER_CAP)
  // AI-506: capped recent-activity list, not a full audit trail — the
  // unbounded gmail_sync_run audit-log entries already cover that.
  const priorHistory = Array.isArray(gmailIngest.syncHistory)
    ? gmailIngest.syncHistory
    : []
  gmailIngest.syncHistory = [...priorHistory, { at: now, ...summary }].slice(-10)
  freshSettings.gmailIngest = gmailIngest
  writeFinanceStore(freshDb)

  return summary
}
