import { createHash } from 'node:crypto'
import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import {
  getSessionTokenFromCookie,
  isAuthenticated,
} from '../../server/auth-middleware'
import { getFeatureFlagSnapshot } from '../../server/feature-flags'

export const Route = createFileRoute('/api/feature-flags')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const token = getSessionTokenFromCookie(request.headers.get('cookie')) ?? 'anonymous'
        const subject = createHash('sha256').update(token).digest('hex').slice(0, 32)
        return json(
          { ok: true, flags: getFeatureFlagSnapshot(subject) },
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      },
    },
  },
})
