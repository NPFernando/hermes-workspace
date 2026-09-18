import { createHash } from 'node:crypto'
import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import {
  getSessionTokenFromCookie,
  isAuthenticated,
} from '../../server/auth-middleware'
import { listDrEvidence, readDrEvidence } from '../../server/dr-evidence'
import { getFeatureFlag } from '../../server/feature-flags'

export const Route = createFileRoute('/api/dr-evidence')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const token = getSessionTokenFromCookie(request.headers.get('cookie')) ?? 'anonymous'
        const subject = createHash('sha256').update(token).digest('hex').slice(0, 32)
        if (!getFeatureFlag('dashboard-dr-evidence', subject).enabledForSubject) {
          return json({ ok: false, error: 'This dashboard feature is not enabled for this session.' }, { status: 404 })
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
