import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { safeErrorMessage } from '../../server/rate-limit'
import { resolveApproval } from '../../server/approvals-store'

export const Route = createFileRoute('/api/approvals/resolve')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const body = (await request.json()) as {
            id?: string
            status?: 'approved' | 'rejected'
            response?: string
          }

          if (!body.id) {
            return json({ ok: false, error: 'id is required' }, { status: 400 })
          }
          if (body.status !== 'approved' && body.status !== 'rejected') {
            return json(
              { ok: false, error: 'status must be "approved" or "rejected"' },
              { status: 400 },
            )
          }

          const record = resolveApproval(body.id, body.status, body.response)
          if (!record) {
            return json(
              { ok: false, error: 'Approval not found or already resolved' },
              { status: 404 },
            )
          }

          return json({ ok: true, approval: record })
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
