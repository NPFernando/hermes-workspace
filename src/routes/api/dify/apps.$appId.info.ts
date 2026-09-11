import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getDifyAppInfo } from '../../../server/dify-client'
import {
  difyErrorResponse,
  enforceDifyRateLimit,
} from '../../../server/dify-route'

export const Route = createFileRoute('/api/dify/apps/$appId/info')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const limited = enforceDifyRateLimit(request, params.appId, 'metadata')
        if (limited) return limited
        try {
          return json({ ok: true, info: await getDifyAppInfo(params.appId) })
        } catch (error) {
          return difyErrorResponse(error)
        }
      },
    },
  },
})
