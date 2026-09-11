import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { resumeDifyWorkflow } from '../../../server/dify-client'
import {
  difyErrorResponse,
  difyJsonHeaders,
  enforceDifyRateLimit,
  getDifyUserId,
} from '../../../server/dify-route'

export const Route = createFileRoute('/api/dify/runs/$appId/$runId/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const limited = enforceDifyRateLimit(request, params.appId, 'events')
        if (limited) return limited
        try {
          const response = await resumeDifyWorkflow(
            params.appId,
            params.runId,
            getDifyUserId(request),
          )
          return new Response(response.body, {
            status: response.status,
            headers: difyJsonHeaders(response),
          })
        } catch (error) {
          return difyErrorResponse(error)
        }
      },
    },
  },
})
