import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { generateTaskFromText } from '../../server/astra-tasks'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

export const Route = createFileRoute('/api/tasks-from-text')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`tasks-from-text:${getClientIp(request)}`, 10, 60_000)) {
          return rateLimitResponse()
        }
        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!text)
          return json({ ok: false, error: 'text is required' }, { status: 400 })
        const suggestion = await generateTaskFromText(text)
        if (!suggestion)
          return json(
            { ok: false, error: 'AI could not parse the task description' },
            { status: 422 },
          )
        return json({ ok: true, suggestion })
      },
    },
  },
})
