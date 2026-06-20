import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../../server/rate-limit'
import {
  
  generateNaveenAiAnalysis,
  readCachedAiAnalysis,
  readNaveenUpdateStatus
} from '../../../server/naveen-update'
import type {ConflictFile} from '../../../server/naveen-update';

export const Route = createFileRoute('/api/update/naveen-ai-analysis')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const cached = readCachedAiAnalysis()
        if (cached) return json({ ok: true, analysis: cached, cached: true })
        return json({ ok: true, analysis: null, cached: false })
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        // Rate-limit: 5 requests per 10 minutes (hermes calls are expensive)
        if (!rateLimit(`naveen-ai:${getClientIp(request)}`, 5, 600_000)) {
          return rateLimitResponse()
        }
        try {
          const body = (await request.json().catch(() => ({}))) as {
            conflicts?: Array<ConflictFile>
          }
          // Use provided conflicts or fetch from current status
          let conflicts = body.conflicts
          if (!conflicts || conflicts.length === 0) {
            const status = readNaveenUpdateStatus()
            conflicts = status.potentialConflicts
          }
          const analysis = generateNaveenAiAnalysis(conflicts)
          return json({ ok: true, analysis })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
