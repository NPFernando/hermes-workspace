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
 * Never guesses or auto-tries a password from a hint found in the email
 * body — only surfaces the hint text for the user to read and type the
 * real password themselves (explicit user decision, see the plan).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getGmailAccessToken } from './google-oauth'
import {
  FINANCE_INGESTION_UPLOAD_DIR,
  addPendingIngestion,
  getCategoryCorrections,
  listPendingIngestions,
  readFinanceStore,
  writeFinanceStore,
} from './finance-store'
import { isPdfEncrypted, pdfToImages } from './document-normalizer'
import { extractTransactionFromImage, extractTransactionFromText } from './finance-extraction'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// Cheap keyword pre-filter before any LLM call — avoids burning quota
// classifying newsletters, OTPs, and everything else in the inbox.
const SEARCH_QUERY =
  '(invoice OR receipt OR bill OR statement OR payment OR salary OR "payment received" OR "amount due") -category:promotions -category:social'

interface GmailMessagePart {
  mimeType?: string
  filename?: string
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: Array<GmailMessagePart>
}

interface GmailMessage {
  id: string
  payload?: GmailMessagePart
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

function findAttachments(part: GmailMessagePart | undefined): Array<{ filename: string; attachmentId: string; mimeType: string }> {
  if (!part) return []
  const results: Array<{ filename: string; attachmentId: string; mimeType: string }> = []
  if (part.filename && part.body?.attachmentId) {
    results.push({ filename: part.filename, attachmentId: part.body.attachmentId, mimeType: part.mimeType ?? '' })
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
  const res = await gmailFetch(`${GMAIL_API}/messages/${messageId}/attachments/${attachmentId}`, accessToken)
  if (!res.ok) throw new Error(`Failed to download attachment: ${res.status}`)
  const data = (await res.json()) as { data: string }
  fs.mkdirSync(FINANCE_INGESTION_UPLOAD_DIR, { recursive: true, mode: 0o700 })
  const ext = path.extname(filename) || '.bin'
  const savedPath = path.join(FINANCE_INGESTION_UPLOAD_DIR, `gmail-${messageId}-${randomUUID()}${ext}`)
  fs.writeFileSync(savedPath, decodeBase64Url(data.data), { mode: 0o600 })
  return savedPath
}

function alreadyQueued(messageId: string): boolean {
  return listPendingIngestions().some(
    (p) => p.source === 'gmail' && (p.sourceRef === `gmail:${messageId}` || p.sourceRef.includes(`gmail-${messageId}-`)),
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
  const gmailIngest = (settings.gmailIngest && typeof settings.gmailIngest === 'object'
    ? { ...(settings.gmailIngest as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  const lastSyncedAtSeconds = typeof gmailIngest.lastSyncedAtSeconds === 'number' ? gmailIngest.lastSyncedAtSeconds : 0

  // First sync ever: only look back 14 days, not the whole mailbox.
  const afterSeconds = lastSyncedAtSeconds || Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60
  const query = `${SEARCH_QUERY} after:${afterSeconds}`

  const listRes = await gmailFetch(
    `${GMAIL_API}/messages?maxResults=25&q=${encodeURIComponent(query)}`,
    accessToken,
  )
  if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`)
  const listData = (await listRes.json()) as { messages?: Array<{ id: string }> }
  const messageIds = (listData.messages ?? []).map((m) => m.id)

  let queued = 0
  let skippedAlreadyQueued = 0
  const categoryHints = getCategoryCorrections()

  for (const messageId of messageIds) {
    if (alreadyQueued(messageId)) {
      skippedAlreadyQueued += 1
      continue
    }

    const msgRes = await gmailFetch(`${GMAIL_API}/messages/${messageId}?format=full`, accessToken)
    if (!msgRes.ok) continue
    const message = (await msgRes.json()) as GmailMessage
    const bodyText = findPlainTextBody(message.payload)
    const attachments = findAttachments(message.payload).filter(
      (a) => a.mimeType === 'application/pdf' || a.mimeType.startsWith('image/'),
    )

    if (attachments.length === 0) {
      if (!bodyText.trim()) continue
      const extraction = await extractTransactionFromText(bodyText, categoryHints)
      if (!extraction.ok) continue // no clear transaction in this email — skip rather than queue noise
      addPendingIngestion({
        source: 'gmail',
        sourceRef: `gmail:${messageId}`,
        status: 'awaiting_review',
        extracted: extraction.data,
      })
      queued += 1
      continue
    }

    // One attachment per email is the common case (bill/receipt PDF); handle the first one.
    const attachment = attachments[0]
    const savedPath = await downloadAttachment(messageId, attachment.attachmentId, attachment.filename, accessToken)

    const isPdf = savedPath.toLowerCase().endsWith('.pdf')
    if (isPdf && isPdfEncrypted(savedPath)) {
      addPendingIngestion({
        source: 'gmail',
        sourceRef: savedPath,
        status: 'awaiting_password',
        passwordHint: findPasswordHint(bodyText),
      })
      queued += 1
      continue
    }

    let previewImagePath = savedPath
    if (isPdf) {
      const normalized = pdfToImages(savedPath)
      if (!normalized.ok) {
        addPendingIngestion({
          source: 'gmail',
          sourceRef: savedPath,
          status: 'awaiting_review',
          error: `Could not process document: ${normalized.reason}`,
        })
        queued += 1
        continue
      }
      previewImagePath = normalized.imagePaths[0]
    }

    const extraction = await extractTransactionFromImage(previewImagePath, categoryHints)
    addPendingIngestion({
      source: 'gmail',
      sourceRef: savedPath,
      status: 'awaiting_review',
      rawPreviewImagePath: previewImagePath,
      extracted: extraction.ok ? extraction.data : undefined,
      error: extraction.ok ? undefined : extraction.reason,
    })
    queued += 1
  }

  const now = Math.floor(Date.now() / 1000)
  gmailIngest.lastSyncedAtSeconds = now
  // AI-506: capped recent-activity list, not a full audit trail — the
  // unbounded gmail_sync_run audit-log entries already cover that.
  const priorHistory = Array.isArray(gmailIngest.syncHistory) ? gmailIngest.syncHistory : []
  gmailIngest.syncHistory = [
    ...priorHistory,
    { at: now, found: messageIds.length, queued, skippedAlreadyQueued },
  ].slice(-10)
  settings.gmailIngest = gmailIngest
  writeFinanceStore(db)

  return { found: messageIds.length, queued, skippedAlreadyQueued }
}
