import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { summarizeDifyAudit } from '../../../server/dify-audit'
import { enforceDifyRateLimit } from '../../../server/dify-route'

export const Route = createFileRoute('/api/dify/metrics')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const limited = enforceDifyRateLimit(request, 'metrics', 'metrics')
        if (limited) return limited
        return json({ ok: true, summary: summarizeDifyAudit() })
      },
    },
  },
})
