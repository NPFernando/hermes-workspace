import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { uploadDifyFile } from '../../../server/dify-client'
import { getDifyConfig } from '../../../server/dify-config'
import {
  difyErrorResponse,
  enforceDifyRateLimit,
  getDifyUserId,
} from '../../../server/dify-route'

const MAX_FILE_BYTES = 10 * 1024 * 1024
// Leave room for multipart headers and the form field while rejecting an
// obviously oversized request before the runtime parses its body.
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 256 * 1024
const execFileAsync = promisify(execFile)

async function scanFile(entry: File): Promise<void> {
  const command = getDifyConfig().fileScannerCommand
  if (!command) return
  const directory = await mkdtemp(join(tmpdir(), 'hermes-dify-scan-'))
  const path = join(directory, 'upload')
  try {
    await writeFile(path, Buffer.from(await entry.arrayBuffer()), {
      mode: 0o600,
    })
    await execFileAsync(command, [path], {
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    })
  } catch {
    throw new Error('Upload did not pass the configured security scan')
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export const Route = createFileRoute('/api/dify/apps/$appId/files')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const contentLength = Number.parseInt(
          request.headers.get('content-length') ?? '',
          10,
        )
        if (
          Number.isFinite(contentLength) &&
          contentLength > MAX_MULTIPART_BYTES
        ) {
          return json(
            { ok: false, error: 'Upload request is too large' },
            { status: 413 },
          )
        }
        const limited = enforceDifyRateLimit(request, params.appId, 'upload')
        if (limited) return limited
        try {
          const form = await request.formData()
          const entry = form.get('file')
          if (!(entry instanceof File)) {
            return json(
              { ok: false, error: 'A file is required' },
              { status: 400 },
            )
          }
          if (entry.size > MAX_FILE_BYTES) {
            return json(
              { ok: false, error: 'File must be 10 MB or smaller' },
              { status: 413 },
            )
          }
          const allowedTypes = getDifyConfig().allowedFileTypes
          if (
            !allowedTypes.includes('*/*') &&
            !allowedTypes.includes(entry.type.toLowerCase())
          ) {
            return json(
              {
                ok: false,
                error: `File type is not allowed: ${entry.type || 'unknown'}`,
              },
              { status: 415 },
            )
          }
          try {
            await scanFile(entry)
          } catch (error) {
            return json(
              {
                ok: false,
                error:
                  error instanceof Error ? error.message : 'Upload scan failed',
              },
              { status: 422 },
            )
          }
          return json({
            ok: true,
            file: await uploadDifyFile(
              params.appId,
              entry,
              getDifyUserId(request),
            ),
          })
        } catch (error) {
          return difyErrorResponse(error)
        }
      },
    },
  },
})
