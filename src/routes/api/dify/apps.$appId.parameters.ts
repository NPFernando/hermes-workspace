import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getDifyAppParameters } from '../../../server/dify-client'
import {
  difyErrorResponse,
  enforceDifyRateLimit,
} from '../../../server/dify-route'

export const Route = createFileRoute('/api/dify/apps/$appId/parameters')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const limited = enforceDifyRateLimit(request, params.appId, 'metadata')
        if (limited) return limited
        try {
          return json({
            ok: true,
            parameters: await getDifyAppParameters(params.appId),
          })
        } catch (error) {
          return difyErrorResponse(error)
        }
      },
    },
  },
})
