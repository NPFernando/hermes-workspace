import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readDifyAudit } from '../../../server/dify-audit'
import { enforceDifyRateLimit } from '../../../server/dify-route'

export const Route = createFileRoute('/api/dify/history')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const limited = enforceDifyRateLimit(request, 'history', 'history')
        if (limited) return limited
        const url = new URL(request.url)
        const limitValue = Number.parseInt(
          url.searchParams.get('limit') ?? '50',
          10,
        )
        const offsetValue = Number.parseInt(
          url.searchParams.get('offset') ?? '0',
          10,
        )
        const limit = Number.isFinite(limitValue)
          ? Math.min(Math.max(limitValue, 1), 100)
          : 50
        const offset = Number.isFinite(offsetValue)
          ? Math.max(offsetValue, 0)
          : 0
        const entries = readDifyAudit(limit, offset)
        return json({
          ok: true,
          entries,
          nextOffset: entries.length === limit ? offset + limit : null,
        })
      },
    },
  },
})
