/**
 * Direct receipt/bill/statement upload (file picker or mobile camera) →
 * pending_ingestions. Follows the same multipart-handling shape as
 * transcribe.ts and files.ts's upload branch. Never writes a real finance
 * record — extraction result always lands as an `awaiting_review` pending
 * ingestion for the user to confirm or reject via /api/finance.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getClientIp, rateLimit, rateLimitResponse, safeErrorMessage } from '../../server/rate-limit'
import {
  FINANCE_DATA_DIR,
  FINANCE_INGESTION_UPLOAD_DIR,
  addPendingIngestion,
  getCategoryCorrections,
  listPendingIngestions,
} from '../../server/finance-store'
import { isPdfEncrypted, pdfToImages } from '../../server/document-normalizer'
import { extractTransactionFromImage } from '../../server/finance-extraction'

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const UPLOAD_DIR = FINANCE_INGESTION_UPLOAD_DIR

function extensionFor(file: File): string {
  const fromName = path.extname(file.name || '').toLowerCase()
  if (fromName) return fromName
  if (file.type === 'application/pdf') return '.pdf'
  if (file.type === 'image/jpeg') return '.jpg'
  return '.png'
}

export const Route = createFileRoute('/api/finance-upload')({
  server: {
    handlers: {
      /** Serves a pending ingestion's preview image, by id — never a raw path from the client. */
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const id = new URL(request.url).searchParams.get('id')
        if (!id) return json({ ok: false, error: 'Missing id.' }, { status: 400 })

        const pending = listPendingIngestions().find((p) => p.id === id)
        const imagePath = pending?.rawPreviewImagePath
        if (!imagePath) return json({ ok: false, error: 'No preview available.' }, { status: 404 })

        const resolved = path.resolve(imagePath)
        if (!resolved.startsWith(path.resolve(FINANCE_DATA_DIR) + path.sep)) {
          return json({ ok: false, error: 'Invalid preview path.' }, { status: 400 })
        }
        try {
          const buffer = fs.readFileSync(resolved)
          const contentType = resolved.toLowerCase().endsWith('.jpg') || resolved.toLowerCase().endsWith('.jpeg')
            ? 'image/jpeg'
            : 'image/png'
          return new Response(buffer, { headers: { 'content-type': contentType, 'cache-control': 'private, max-age=300' } })
        } catch {
          return json({ ok: false, error: 'Preview file not found.' }, { status: 404 })
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ip = getClientIp(request)
        if (!rateLimit(`finance-upload:${ip}`, 15, 60_000)) {
          return rateLimitResponse()
        }

        try {
          const contentType = request.headers.get('content-type') || ''
          if (!contentType.includes('multipart/form-data')) {
            return json({ ok: false, error: 'Expected multipart/form-data upload.' }, { status: 400 })
          }

          const form = await request.formData()
          const file = form.get('file')
          if (!(file instanceof File)) {
            return json({ ok: false, error: 'Missing file.' }, { status: 400 })
          }
          if (file.size <= 0) {
            return json({ ok: false, error: 'File is empty.' }, { status: 400 })
          }
          if (file.size > MAX_UPLOAD_BYTES) {
            return json({ ok: false, error: 'File exceeds 15 MB limit.' }, { status: 413 })
          }

          fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 })
          const savedPath = path.join(UPLOAD_DIR, `${randomUUID()}${extensionFor(file)}`)
          fs.writeFileSync(savedPath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 })

          const isPdf = savedPath.toLowerCase().endsWith('.pdf')
          if (isPdf && isPdfEncrypted(savedPath)) {
            const pending = addPendingIngestion({
              source: 'upload',
              sourceRef: savedPath,
              status: 'awaiting_password',
            })
            return json({ ok: true, pendingIngestionId: pending.id, status: pending.status })
          }

          let previewImagePath = savedPath
          if (isPdf) {
            const normalized = pdfToImages(savedPath)
            if (!normalized.ok) {
              const pending = addPendingIngestion({
                source: 'upload',
                sourceRef: savedPath,
                status: 'awaiting_review',
                error: `Could not process document: ${normalized.reason}`,
              })
              return json({ ok: true, pendingIngestionId: pending.id, status: pending.status })
            }
            previewImagePath = normalized.imagePaths[0]
          }

          const extraction = await extractTransactionFromImage(previewImagePath, getCategoryCorrections())
          const pending = addPendingIngestion({
            source: 'upload',
            sourceRef: savedPath,
            status: 'awaiting_review',
            rawPreviewImagePath: previewImagePath,
            extracted: extraction.ok ? extraction.data : undefined,
            error: extraction.ok ? undefined : extraction.reason,
          })

          return json({ ok: true, pendingIngestionId: pending.id, status: pending.status })
        } catch (error) {
          return json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
        }
      },
    },
  },
})
