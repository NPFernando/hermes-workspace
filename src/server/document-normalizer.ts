/**
 * Normalizes documents (PDFs, possibly password-protected) into plain PNG
 * images so both ingestion paths (Gmail attachments, direct upload) can
 * share one AI-vision extraction pipeline (finance-extraction.ts). Photos
 * uploaded directly skip this module entirely — they're already images.
 *
 * Shells out to qpdf (decryption) and pdftoppm/poppler-utils (rasterizing),
 * the same spawnSync pattern llm-signal-engine.ts's selectHarpRoutes() uses
 * for its own external process call. Never throws — every failure mode
 * (wrong password, corrupt file, missing binary) comes back as a typed
 * result so callers can route the item into the right pending_ingestion
 * status instead of crashing the ingestion run.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const INGESTION_TMP_DIR = path.join(
  os.homedir(),
  '.hermes',
  'finance',
  'ingestion-tmp',
)

function ensureTmpDir(): void {
  fs.mkdirSync(INGESTION_TMP_DIR, { recursive: true, mode: 0o700 })
}

export function isPdfEncrypted(pdfPath: string): boolean {
  const result = spawnSync('qpdf', ['--show-encryption', pdfPath], {
    encoding: 'utf-8',
    timeout: 15_000,
  })
  if (result.status === 0) {
    return !/not encrypted/i.test(result.stdout.trim())
  }
  // qpdf exits non-zero for password-protected files it can't open without one.
  return /password|encrypt/i.test(`${result.stdout}${result.stderr}`)
}

export type PdfToImagesResult =
  | { ok: true; imagePaths: Array<string> }
  | { ok: false; reason: 'bad_password' | 'conversion_failed' | 'not_found' }

export function pdfToImages(
  pdfPath: string,
  password?: string,
): PdfToImagesResult {
  if (!fs.existsSync(pdfPath)) return { ok: false, reason: 'not_found' }
  ensureTmpDir()
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let sourcePath = pdfPath

  if (password !== undefined) {
    const decryptedPath = path.join(INGESTION_TMP_DIR, `${jobId}-decrypted.pdf`)
    const decrypt = spawnSync(
      'qpdf',
      ['--decrypt', `--password=${password}`, pdfPath, decryptedPath],
      { encoding: 'utf-8', timeout: 20_000 },
    )
    if (decrypt.status !== 0) {
      return { ok: false, reason: 'bad_password' }
    }
    sourcePath = decryptedPath
  }

  const outPrefix = path.join(INGESTION_TMP_DIR, `${jobId}-page`)
  const convert = spawnSync(
    'pdftoppm',
    ['-png', '-r', '150', sourcePath, outPrefix],
    {
      encoding: 'utf-8',
      timeout: 30_000,
    },
  )
  if (convert.status !== 0) {
    return { ok: false, reason: 'conversion_failed' }
  }

  const dir = path.dirname(outPrefix)
  const prefix = path.basename(outPrefix)
  const imagePaths = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.png'))
    .sort()
    .map((f) => path.join(dir, f))

  if (imagePaths.length === 0) return { ok: false, reason: 'conversion_failed' }
  return { ok: true, imagePaths }
}
