/**
 * Gmail sync — manual "Sync now" only for now (no cron; see the plan's own
 * sequencing rationale: prove extraction quality on real mail before
 * automating it). Lists recent messages via the Gmail API using the
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
  writeFinanceStore,
} from './finance-store'
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

const MAX_PAGES = 4
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
      (p.sourceRef === `gmail:${messageId}` ||
        p.sourceRef.includes(`gmail-${messageId}-`)),
  )
}

export interface GmailSyncResult {
  found: number
  queued: number
  skippedAlreadyQueued: number
}

export async function syncGmailNow(): Promise<GmailSyncResult> {
  const accessToken = await getGmailAccessToken()
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const gmailIngest = (
    settings.gmailIngest && typeof settings.gmailIngest === 'object'
      ? { ...(settings.gmailIngest as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>
  const lastSyncedAtSeconds =
    typeof gmailIngest.lastSyncedAtSeconds === 'number'
      ? gmailIngest.lastSyncedAtSeconds
      : 0

  // First sync ever: only look back 14 days, not the whole mailbox.
  const afterSeconds =
    lastSyncedAtSeconds || Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60
  const knownSenders = listKnownSenders()
  const query = buildSearchQuery(knownSenders, afterSeconds)

  // Broadening the query with known-sender clauses means more candidates
  // than a single 25-result page can hold — paginate (bounded) instead of
  // relying on one flat maxResults, or a noisy month could push a real
  // statement off the end of page one silently.
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

  let queued = 0
  let skippedAlreadyQueued = 0
  const categoryHints = getCategoryCorrections()

  for (const messageId of messageIds) {
    if (alreadyQueued(messageId)) {
      skippedAlreadyQueued += 1
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
    const attachments = findAttachments(message.payload).filter(
      (a) =>
        a.mimeType === 'application/pdf' || a.mimeType.startsWith('image/'),
    )

    if (attachments.length === 0) {
      if (!bodyText.trim()) continue
      const extraction = await extractTransactionFromText(
        bodyText,
        categoryHints,
      )
      if (!extraction.ok) continue // no clear transaction in this email — skip rather than queue noise
      addPendingIngestion({
        source: 'gmail',
        sourceRef: `gmail:${messageId}`,
        status: 'awaiting_review',
        extracted: extraction.data,
        matchedSenderId: matchedSender?.id,
        matchedSenderLabel: matchedSender?.label,
      })
      queued += 1
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
        addPendingIngestion({
          source: 'gmail',
          sourceRef: savedPath,
          status: 'awaiting_password',
          passwordHint: matchedSender?.passwordScheme ?? findPasswordHint(bodyText),
          matchedSenderId: matchedSender?.id,
          matchedSenderLabel: matchedSender?.label,
        })
        queued += 1
        continue
      }
    }

    let previewImagePath = savedPath
    if (isPdf) {
      const normalized = pdfToImages(savedPath, unlockedPassword)
      if (!normalized.ok) {
        addPendingIngestion({
          source: 'gmail',
          sourceRef: savedPath,
          status: 'awaiting_review',
          error: `Could not process document: ${normalized.reason}`,
          matchedSenderId: matchedSender?.id,
          matchedSenderLabel: matchedSender?.label,
        })
        queued += 1
        continue
      }
      previewImagePath = normalized.imagePaths[0]
    }

    const extraction = await extractTransactionFromImage(
      previewImagePath,
      categoryHints,
    )
    addPendingIngestion({
      source: 'gmail',
      sourceRef: savedPath,
      status: 'awaiting_review',
      rawPreviewImagePath: previewImagePath,
      extracted: extraction.ok ? extraction.data : undefined,
      error: extraction.ok ? undefined : extraction.reason,
      matchedSenderId: matchedSender?.id,
      matchedSenderLabel: matchedSender?.label,
    })
    queued += 1
  }

  const now = Math.floor(Date.now() / 1000)
  gmailIngest.lastSyncedAtSeconds = now
  // AI-506: capped recent-activity list, not a full audit trail — the
  // unbounded gmail_sync_run audit-log entries already cover that.
  const priorHistory = Array.isArray(gmailIngest.syncHistory)
    ? gmailIngest.syncHistory
    : []
  gmailIngest.syncHistory = [
    ...priorHistory,
    { at: now, found: messageIds.length, queued, skippedAlreadyQueued },
  ].slice(-10)
  settings.gmailIngest = gmailIngest
  writeFinanceStore(db)

  return { found: messageIds.length, queued, skippedAlreadyQueued }
}
