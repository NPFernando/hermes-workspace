/**
 * Direct receipt/bill/statement upload (file picker or mobile camera) →
 * pending_ingestions. Follows the same multipart-handling shape as
 * transcribe.ts and files.ts's upload branch. Never writes a real finance
 * record — extraction result always lands as an `awaiting_review` pending
 * ingestion for the user to confirm or reject via /api/finance.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { resolveFinanceFilePath } from '../../server/finance-file-security'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  safeErrorMessage,
} from '../../server/rate-limit'
import {
  FINANCE_DATA_DIR,
  FINANCE_INGESTION_UPLOAD_DIR,
  addPendingIngestion,
  findPendingIngestionByChecksum,
  getCategoryCorrections,
  listPendingIngestions,
  readFinanceStore,
  updateFinanceRecord,
} from '../../server/finance-store'
import { isPdfEncrypted, pdfToImages } from '../../server/document-normalizer'
import { classifyFinanceDocument } from '../../server/finance-document-classifier'
import {
  extractContractNoteFromImages,
  extractEmploymentContract,
  extractFdCertificateFromImages,
  extractSalarySlipFromImages,
  extractTransactionFromImage,
  extractTransactionsFromImages,
  mimeTypeForImageExtension,
} from '../../server/finance-extraction'

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const UPLOAD_DIR = FINANCE_INGESTION_UPLOAD_DIR

function extensionFor(file: File): string {
  const fromName = path.extname(file.name || '').toLowerCase()
  if (fromName) return fromName
  if (file.type === 'application/pdf') return '.pdf'
  if (file.type === 'image/jpeg') return '.jpg'
  return '.png'
}

async function addStatementPendingItems(
  sourceRef: string,
  previewImagePath: string,
  imagePaths: Array<string>,
  checksumSha256: string,
  documentClass: ReturnType<typeof classifyFinanceDocument>['documentClass'],
) {
  const extraction = await extractTransactionsFromImages(
    imagePaths,
    getCategoryCorrections(),
  )
  if (!extraction.ok || extraction.data.length === 0) {
    return [
      addPendingIngestion({
        source: 'upload',
        documentType: 'statement',
        documentClass,
        sourceRef,
        checksumSha256,
        status: 'awaiting_review',
        rawPreviewImagePath: previewImagePath,
        error: extraction.ok ? 'No posted transactions found.' : extraction.reason,
      }),
    ]
  }
  return extraction.data.map((extracted) =>
    addPendingIngestion({
      source: 'upload',
      documentType: 'statement',
      documentClass,
      sourceRef,
      checksumSha256,
      status: 'awaiting_review',
      rawPreviewImagePath: previewImagePath,
      extracted,
    }),
  )
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
        if (!id)
          return json({ ok: false, error: 'Missing id.' }, { status: 400 })

        const pending = listPendingIngestions().find((p) => p.id === id)
        const imagePath = pending?.rawPreviewImagePath
        if (!imagePath)
          return json(
            { ok: false, error: 'No preview available.' },
            { status: 404 },
          )

        const resolved = resolveFinanceFilePath(imagePath, FINANCE_DATA_DIR)
        if (!resolved) {
          return json(
            { ok: false, error: 'Invalid preview path.' },
            { status: 400 },
          )
        }
        try {
          const buffer = fs.readFileSync(resolved)
          const contentType = mimeTypeForImageExtension(path.extname(resolved))
          return new Response(buffer, {
            headers: {
              'content-type': contentType,
              'cache-control': 'private, max-age=300',
            },
          })
        } catch {
          return json(
            { ok: false, error: 'Preview file not found.' },
            { status: 404 },
          )
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
            return json(
              { ok: false, error: 'Expected multipart/form-data upload.' },
              { status: 400 },
            )
          }

          const form = await request.formData()
          const file = form.get('file')
          const requestedDocumentType = form.get('documentType')
          const accountId = form.get('accountId')
          const holdingId = form.get('holdingId')
          const taxRecordId = form.get('taxRecordId')
          const insurancePolicyId = form.get('insurancePolicyId')
          const isBankDocument = requestedDocumentType === 'bank_document'
          const isInvestmentDocument = requestedDocumentType === 'investment_document'
          const isTaxDocument = requestedDocumentType === 'tax_document'
          const isInsuranceDocument = requestedDocumentType === 'insurance_document'
          if (isBankDocument || isInvestmentDocument || isTaxDocument || isInsuranceDocument) {
            const targetId = isBankDocument
              ? accountId
              : isInvestmentDocument
                ? holdingId
                : isTaxDocument
                  ? taxRecordId
                  : insurancePolicyId
            if (typeof targetId !== 'string' || !targetId.trim()) {
              return json({ ok: false, error: `${isBankDocument ? 'accountId' : isInvestmentDocument ? 'holdingId' : isTaxDocument ? 'taxRecordId' : 'insurancePolicyId'} is required for this document.` }, { status: 400 })
            }
            const db = readFinanceStore()
            const targetExists = isBankDocument
              ? db.finance_accounts.some((account) => account.id === targetId)
              : isInvestmentDocument
                ? db.stock_holdings.some((holding) => holding.id === targetId)
                : isTaxDocument
                  ? db.tax_records.some((record) => record.id === targetId)
                  : db.insurance_policies.some((policy) => policy.id === targetId)
            if (!targetExists) {
              return json({ ok: false, error: `${isBankDocument ? 'Finance account' : isInvestmentDocument ? 'Stock holding' : isTaxDocument ? 'Tax record' : 'Insurance policy'} not found.` }, { status: 404 })
            }
          }
          const documentType =
            requestedDocumentType === 'contract'
              ? 'contract'
              : requestedDocumentType === 'statement'
                ? 'statement'
                : 'transaction'
          const documentClass = classifyFinanceDocument({
            filename: file instanceof File ? file.name : undefined,
            requestedDocumentType: documentType,
          }).documentClass
          if (!(file instanceof File)) {
            return json({ ok: false, error: 'Missing file.' }, { status: 400 })
          }
          if (file.size <= 0) {
            return json({ ok: false, error: 'File is empty.' }, { status: 400 })
          }
          if (file.size > MAX_UPLOAD_BYTES) {
            return json(
              { ok: false, error: 'File exceeds 15 MB limit.' },
              { status: 413 },
            )
          }

          const fileBytes = Buffer.from(await file.arrayBuffer())
          const checksumSha256 = createHash('sha256')
            .update(fileBytes)
            .digest('hex')
          const duplicate = findPendingIngestionByChecksum(checksumSha256)
          if (duplicate) {
            return json(
              {
                ok: false,
                error: 'This document is already in the finance review history.',
                pendingIngestionId: duplicate.id,
              },
              { status: 409 },
            )
          }

          fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 })
          const savedPath = path.join(
            UPLOAD_DIR,
            `${randomUUID()}${extensionFor(file)}`,
          )
          fs.writeFileSync(savedPath, fileBytes, {
            mode: 0o600,
          })

          if (isBankDocument || isInvestmentDocument || isTaxDocument || isInsuranceDocument) {
            updateFinanceRecord(
              isBankDocument ? 'account' : isInvestmentDocument ? 'stock_holding' : isTaxDocument ? 'tax' : 'insurance_policy',
              (isBankDocument ? accountId : isInvestmentDocument ? holdingId : isTaxDocument ? taxRecordId : insurancePolicyId) as string,
              {
              documentRef: savedPath,
              },
            )
            return json({ ok: true, accountId, holdingId, taxRecordId, insurancePolicyId, status: 'linked' })
          }

          const isPdf = savedPath.toLowerCase().endsWith('.pdf')
          if (isPdf && isPdfEncrypted(savedPath)) {
            const pending = addPendingIngestion({
              source: 'upload',
              documentType,
              documentClass,
              sourceRef: savedPath,
              checksumSha256,
              status: 'awaiting_password',
            })
            return json({
              ok: true,
              pendingIngestionId: pending.id,
              status: pending.status,
            })
          }

          let previewImagePath = savedPath
          let allImagePaths = [savedPath]
          if (isPdf) {
            const normalized = pdfToImages(savedPath)
            if (!normalized.ok) {
              const pending = addPendingIngestion({
                source: 'upload',
                documentType,
                documentClass,
                sourceRef: savedPath,
                checksumSha256,
                status: 'awaiting_review',
                error: `Could not process document: ${normalized.reason}`,
              })
              return json({
                ok: true,
                pendingIngestionId: pending.id,
                status: pending.status,
              })
            }
            previewImagePath = normalized.imagePaths[0]
            allImagePaths = normalized.imagePaths
          }

          if (documentType === 'statement') {
            const pending = await addStatementPendingItems(
              savedPath,
              previewImagePath,
              allImagePaths,
              checksumSha256,
              documentClass,
            )
            return json({
              ok: true,
              pendingIngestionIds: pending.map((item) => item.id),
              status: 'awaiting_review',
            })
          }

          if (documentClass === 'salary_slip') {
            const extraction = await extractSalarySlipFromImages(allImagePaths)
            const pending = addPendingIngestion({
              source: 'upload',
              documentType: 'transaction',
              documentClass,
              sourceRef: savedPath,
              checksumSha256,
              status: 'awaiting_review',
              rawPreviewImagePath: previewImagePath,
              extractedSalarySlip: extraction.ok ? extraction.data : undefined,
              error: extraction.ok ? undefined : extraction.reason,
            })
            return json({
              ok: true,
              pendingIngestionId: pending.id,
              status: pending.status,
            })
          }

          if (documentClass === 'contract_note') {
            const extraction = await extractContractNoteFromImages(allImagePaths)
            const pending = addPendingIngestion({
              source: 'upload',
              documentType: 'transaction',
              documentClass,
              sourceRef: savedPath,
              checksumSha256,
              status: 'awaiting_review',
              rawPreviewImagePath: previewImagePath,
              extractedContractNote: extraction.ok ? extraction.data : undefined,
              error: extraction.ok ? undefined : extraction.reason,
            })
            return json({
              ok: true,
              pendingIngestionId: pending.id,
              status: pending.status,
            })
          }

          if (documentClass === 'fd_certificate') {
            const extraction = await extractFdCertificateFromImages(allImagePaths)
            const pending = addPendingIngestion({
              source: 'upload',
              documentType: 'transaction',
              documentClass,
              sourceRef: savedPath,
              checksumSha256,
              status: 'awaiting_review',
              rawPreviewImagePath: previewImagePath,
              extractedFdCertificate: extraction.ok ? extraction.data : undefined,
              error: extraction.ok ? undefined : extraction.reason,
            })
            return json({
              ok: true,
              pendingIngestionId: pending.id,
              status: pending.status,
            })
          }

          if (documentType === 'contract') {
            const extraction = await extractEmploymentContract(allImagePaths)
            const pending = addPendingIngestion({
              source: 'upload',
              documentType: 'contract',
              documentClass,
              sourceRef: savedPath,
              checksumSha256,
              status: 'awaiting_review',
              rawPreviewImagePath: previewImagePath,
              extractedContract: extraction.ok ? extraction.data : undefined,
              error: extraction.ok ? undefined : extraction.reason,
            })
            return json({
              ok: true,
              pendingIngestionId: pending.id,
              status: pending.status,
            })
          }

          const extraction = await extractTransactionFromImage(
            previewImagePath,
            getCategoryCorrections(),
          )
          const pending = addPendingIngestion({
            source: 'upload',
            documentType: 'transaction',
            documentClass,
            sourceRef: savedPath,
            checksumSha256,
            status: 'awaiting_review',
            rawPreviewImagePath: previewImagePath,
            extracted: extraction.ok ? extraction.data : undefined,
            error: extraction.ok ? undefined : extraction.reason,
          })

          return json({
            ok: true,
            pendingIngestionId: pending.id,
            status: pending.status,
          })
        } catch (error) {
          return json(
            { ok: false, error: safeErrorMessage(error) },
            { status: 500 },
          )
        }
      },
    },
  },
})
