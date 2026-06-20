import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { classifyOne } from '../../lib/sister-routing'

export const Route = createFileRoute('/api/route-sister')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let message = ''
        try {
          const body = await request.json() as { message?: unknown }
          message = typeof body.message === 'string' ? body.message.trim() : ''
        } catch {
          return json({ ok: false, error: 'invalid body' }, { status: 400 })
        }

        if (!message) {
          return json({ ok: false, error: 'message required' }, { status: 400 })
        }

        return json({ ok: true, ...classifyOne(message) })
      },
    },
  },
})
