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
  listKnownSenders,
  decryptKnownSenderPassword,
  listPendingIngestions,
  readFinanceStore,
  writeFinanceStore,
} from './finance-store'
import { isPdfEncrypted, pdfToImages } from './document-normalizer'
import { classifyFinanceDocument } from './finance-document-classifier'
import {
  extractContractNoteFromImages,
  extractContractNoteFromText,
  extractFdCertificateFromImages,
  extractFdCertificateFromText,
  extractSalarySlipFromImages,
  extractSalarySlipFromText,
  extractTransactionFromImage,
  extractTransactionFromText,
} from './finance-extraction'

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

export function buildSearchQuery(
  knownSenders: Array<{ matchAddress?: string; matchDomain?: string }>,
  afterSeconds: number,
): string {
  const senderClauses = knownSenders
    .flatMap((sender) => [sender.matchAddress, sender.matchDomain])
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `from:${value.trim()}`)
  return `${SEARCH_QUERY}${senderClauses.length ? ` OR ${senderClauses.join(' OR ')}` : ''} after:${Math.floor(afterSeconds)}`
}

export function matchKnownSender(
  fromHeader: string,
  knownSenders: Array<{ matchAddress?: string; matchDomain?: string }>,
) {
  const normalized = fromHeader.toLowerCase()
  return knownSenders.find((sender) => {
    const address = sender.matchAddress?.trim().toLowerCase()
    const domain = sender.matchDomain?.trim().toLowerCase()
    return Boolean((address && normalized.includes(address)) || (domain && normalized.includes(domain)))
  })
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
  const messageIds: Array<string> = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ maxResults: '25', q: query })
    if (pageToken) params.set('pageToken', pageToken)
    const listRes = await gmailFetch(`${GMAIL_API}/messages?${params}`, accessToken)
    if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`)
    const listData = (await listRes.json()) as {
      messages?: Array<{ id: string }>
      nextPageToken?: string
    }
    messageIds.push(...(listData.messages ?? []).map((m) => m.id))
    pageToken = listData.nextPageToken ?? ''
  } while (pageToken)

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
    const fromHeader = ((message.payload as GmailMessagePart & { headers?: Array<{ name?: string; value?: string }> })?.headers ?? [])
      .find((header) => header.name?.toLowerCase() === 'from')?.value ?? ''
    const matchedSender = matchKnownSender(fromHeader, knownSenders)
    const attachments = findAttachments(message.payload).filter(
      (a) =>
        a.mimeType === 'application/pdf' || a.mimeType.startsWith('image/'),
    )

    if (attachments.length === 0) {
      if (!bodyText.trim()) continue
      const documentClass = classifyFinanceDocument({ text: bodyText }).documentClass
      if (documentClass === 'salary_slip') {
        const salaryExtraction = await extractSalarySlipFromText(bodyText)
        if (salaryExtraction.ok) {
          addPendingIngestion({
            source: 'gmail',
            sourceRef: `gmail:${messageId}`,
            status: 'awaiting_review',
            documentClass,
            extractedSalarySlip: salaryExtraction.data,
          })
          queued += 1
        }
        continue
      }
      if (documentClass === 'contract_note') {
        const noteExtraction = await extractContractNoteFromText(bodyText)
        if (noteExtraction.ok) {
          addPendingIngestion({
            source: 'gmail',
            sourceRef: `gmail:${messageId}`,
            status: 'awaiting_review',
            documentClass,
            extractedContractNote: noteExtraction.data,
          })
          queued += 1
        }
        continue
      }
      if (documentClass === 'fd_certificate') {
        const certificateExtraction = await extractFdCertificateFromText(bodyText)
        if (certificateExtraction.ok) {
          addPendingIngestion({
            source: 'gmail',
            sourceRef: `gmail:${messageId}`,
            status: 'awaiting_review',
            documentClass,
            extractedFdCertificate: certificateExtraction.data,
          })
          queued += 1
        }
        continue
      }
      const extraction = await extractTransactionFromText(
        bodyText,
        categoryHints,
      )
      if (!extraction.ok) continue // no clear transaction in this email — skip rather than queue noise
      addPendingIngestion({
        source: 'gmail',
        sourceRef: `gmail:${messageId}`,
        status: 'awaiting_review',
        documentClass: classifyFinanceDocument({ text: bodyText }).documentClass,
        extracted: extraction.data,
      })
      queued += 1
      continue
    }

    // One attachment per email is the common case (bill/receipt PDF); handle the first one.
    const attachment = attachments[0]
    const documentClass = classifyFinanceDocument({
      filename: attachment.filename,
      text: bodyText,
    }).documentClass
    const savedPath = await downloadAttachment(
      messageId,
      attachment.attachmentId,
      attachment.filename,
      accessToken,
    )

    const isPdf = savedPath.toLowerCase().endsWith('.pdf')
    let previewImagePath = savedPath
    let imagePaths = [savedPath]
    let unlockedPdf = false
    if (isPdf && isPdfEncrypted(savedPath)) {
      const password = matchedSender ? decryptKnownSenderPassword(matchedSender.id) : undefined
      if (password) {
        const unlocked = pdfToImages(savedPath, password)
        if (unlocked.ok) {
          previewImagePath = unlocked.imagePaths[0]
          imagePaths = unlocked.imagePaths
          unlockedPdf = true
        }
      }
      if (imagePaths.length > 1 || previewImagePath !== savedPath) {
        // Continue through normal extraction below after a successful unlock.
      } else {
      addPendingIngestion({
        source: 'gmail',
        sourceRef: savedPath,
        status: 'awaiting_password',
        documentClass,
        passwordHint: findPasswordHint(bodyText),
        matchedSenderId: matchedSender?.id,
        matchedSenderLabel: matchedSender?.label,
      })
      queued += 1
      continue
      }
    }

    if (isPdf && !unlockedPdf) {
      const normalized = pdfToImages(savedPath)
      if (!normalized.ok) {
        addPendingIngestion({
          source: 'gmail',
          sourceRef: savedPath,
          status: 'awaiting_review',
          documentClass,
          error: `Could not process document: ${normalized.reason}`,
        })
        queued += 1
        continue
      }
      previewImagePath = normalized.imagePaths[0]
      imagePaths = normalized.imagePaths
    }

    if (documentClass === 'salary_slip') {
      const salaryExtraction = await extractSalarySlipFromImages(imagePaths)
      addPendingIngestion({
        source: 'gmail',
        sourceRef: savedPath,
        status: 'awaiting_review',
        documentClass,
        rawPreviewImagePath: previewImagePath,
        extractedSalarySlip: salaryExtraction.ok
          ? salaryExtraction.data
          : undefined,
        error: salaryExtraction.ok ? undefined : salaryExtraction.reason,
      })
      queued += 1
      continue
    }

    if (documentClass === 'contract_note') {
      const noteExtraction = await extractContractNoteFromImages(imagePaths)
      addPendingIngestion({
        source: 'gmail',
        sourceRef: savedPath,
        status: 'awaiting_review',
        documentClass,
        rawPreviewImagePath: previewImagePath,
        extractedContractNote: noteExtraction.ok
          ? noteExtraction.data
          : undefined,
        error: noteExtraction.ok ? undefined : noteExtraction.reason,
      })
      queued += 1
      continue
    }

    if (documentClass === 'fd_certificate') {
      const certificateExtraction = await extractFdCertificateFromImages(imagePaths)
      addPendingIngestion({
        source: 'gmail',
        sourceRef: savedPath,
        status: 'awaiting_review',
        documentClass,
        rawPreviewImagePath: previewImagePath,
        extractedFdCertificate: certificateExtraction.ok
          ? certificateExtraction.data
          : undefined,
        error: certificateExtraction.ok ? undefined : certificateExtraction.reason,
      })
      queued += 1
      continue
    }

    const extraction = await extractTransactionFromImage(
      previewImagePath,
      categoryHints,
    )
    addPendingIngestion({
      source: 'gmail',
      sourceRef: savedPath,
      status: 'awaiting_review',
      documentClass,
      matchedSenderId: matchedSender?.id,
      matchedSenderLabel: matchedSender?.label,
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
  const priorHistory = Array.isArray(gmailIngest.syncHistory)
    ? gmailIngest.syncHistory
    : []
  gmailIngest.syncHistory = [
    ...priorHistory,
    { at: now, found: messageIds.length, queued, skippedAlreadyQueued },
  ].slice(-10)
  const latest = readFinanceStore()
  latest.settings.gmailIngest = gmailIngest
  writeFinanceStore(latest)

  return { found: messageIds.length, queued, skippedAlreadyQueued }
}
