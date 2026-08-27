/**
 * Serves the original uploaded document behind a finance record's
 * `documentRef` (currently: income_source, i.e. an employment contract
 * confirmed via the AI intake path). Looks the path up server-side from the
 * record id — never trusts a client-supplied path — and validates the
 * resolved path stays under FINANCE_DATA_DIR, same guard as
 * finance-upload.ts's preview-image GET handler.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { FINANCE_DATA_DIR, readFinanceStore } from '../../server/finance-store'

function contentTypeFor(filePath: string): string {
  const ext = filePath.toLowerCase()
  if (ext.endsWith('.pdf')) return 'application/pdf'
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

export const Route = createFileRoute('/api/finance-document')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const kind = url.searchParams.get('kind')
        const id = url.searchParams.get('id')
        if (kind !== 'income_source' || !id) {
          return json({ ok: false, error: 'kind=income_source and id are required.' }, { status: 400 })
        }

        const record = readFinanceStore().income_sources.find((r) => r.id === id)
        const documentRef = record?.documentRef
        if (!documentRef) return json({ ok: false, error: 'No document on file for this record.' }, { status: 404 })

        const resolved = path.resolve(documentRef)
        if (!resolved.startsWith(path.resolve(FINANCE_DATA_DIR) + path.sep)) {
          return json({ ok: false, error: 'Invalid document path.' }, { status: 400 })
        }
        try {
          const buffer = fs.readFileSync(resolved)
          return new Response(buffer, {
            headers: {
              'content-type': contentTypeFor(resolved),
              'content-disposition': `inline; filename="${path.basename(resolved)}"`,
              'cache-control': 'private, max-age=300',
            },
          })
        } catch {
          return json({ ok: false, error: 'Document file not found.' }, { status: 404 })
        }
      },
    },
  },
})
