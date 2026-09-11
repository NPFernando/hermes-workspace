import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { stopDifyRun } from '../../../server/dify-client'
import {
  appendDifyAudit,
  difyErrorResponse,
  enforceDifyRateLimit,
  getDifyUserId,
  requireDifyJson,
} from '../../../server/dify-route'

export const Route = createFileRoute('/api/dify/apps/$appId/stop')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const contentTypeError = requireDifyJson(request)
        if (contentTypeError) return contentTypeError
        const limited = enforceDifyRateLimit(request, params.appId, 'stop')
        if (limited) return limited
        try {
          const parsed = (await request.json()) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return json(
              { ok: false, error: 'Request body must be a JSON object' },
              { status: 400 },
            )
          }
          const body = parsed as Record<string, unknown>
          if (
            typeof body.taskId !== 'string' ||
            (body.mode !== 'workflow' &&
              body.mode !== 'chat' &&
              body.mode !== 'completion')
          ) {
            return json(
              { ok: false, error: 'taskId and mode are required' },
              { status: 400 },
            )
          }
          const result = await stopDifyRun(
            params.appId,
            body.taskId,
            body.mode,
            getDifyUserId(request),
          )
          appendDifyAudit({
            action: 'dify_stop',
            appId: params.appId,
            mode: body.mode,
            outcome: 'success',
            status: 200,
          })
          return json({
            ok: true,
            result,
          })
        } catch (error) {
          if (error instanceof SyntaxError) {
            return json(
              { ok: false, error: 'Invalid JSON body' },
              { status: 400 },
            )
          }
          return difyErrorResponse(error)
        }
      },
    },
  },
})
