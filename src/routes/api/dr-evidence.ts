import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { listDrEvidence, readDrEvidence } from '../../server/dr-evidence'

export const Route = createFileRoute('/api/dr-evidence')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const file = new URL(request.url).searchParams.get('file')
        if (!file) return json({ ok: true, evidence: listDrEvidence() })
        const report = readDrEvidence(file)
        if (!report) return json({ ok: false, error: 'Evidence file not found.' }, { status: 404 })
        return json(report, {
          headers: {
            'Content-Disposition': `attachment; filename="${report.file}"`,
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
