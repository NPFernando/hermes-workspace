import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { safeErrorMessage } from '../../server/rate-limit'
import { listPendingApprovals } from '../../server/approvals-store'

export const Route = createFileRoute('/api/approvals/pending')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const sessionId = new URL(request.url).searchParams.get('session_id')
          if (!sessionId) {
            return json(
              { ok: false, error: 'session_id query param required' },
              { status: 400 },
            )
          }

          const pending = listPendingApprovals(sessionId)
          return json({ ok: true, pending: pending[0] ?? null })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
