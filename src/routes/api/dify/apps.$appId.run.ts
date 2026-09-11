import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { runDifyApp } from '../../../server/dify-client'
import {
  appendDifyAudit,
  difyErrorResponse,
  difyJsonHeaders,
  enforceDifyRateLimit,
  getDifyUserId,
  requireDifyJson,
} from '../../../server/dify-route'

const MAX_BODY_BYTES = 128 * 1024

export const Route = createFileRoute('/api/dify/apps/$appId/run')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const contentTypeError = requireDifyJson(request)
        if (contentTypeError) return contentTypeError
        const limited = enforceDifyRateLimit(request, params.appId, 'run')
        if (limited) return limited
        const startedAt = Date.now()
        try {
          const raw = await request.text()
          if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
            return json(
              { ok: false, error: 'Request body is too large' },
              { status: 413 },
            )
          }
          const parsed = JSON.parse(raw) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return json(
              { ok: false, error: 'Request body must be a JSON object' },
              { status: 400 },
            )
          }
          const body = parsed as Record<string, unknown>
          const mode =
            body.mode === 'workflow'
              ? 'workflow'
              : body.mode === 'completion'
                ? 'completion'
                : 'chat'
          const responseMode =
            body.response_mode === 'blocking' ? 'blocking' : 'streaming'
          const inputs =
            body.inputs &&
            typeof body.inputs === 'object' &&
            !Array.isArray(body.inputs)
              ? body.inputs
              : {}
          const payload: Record<string, unknown> = {
            mode,
            inputs,
            response_mode: responseMode,
            user: getDifyUserId(request),
          }
          if (typeof body.query === 'string') payload.query = body.query
          if (typeof body.conversation_id === 'string') {
            payload.conversation_id = body.conversation_id
          }
          if (Array.isArray(body.files)) payload.files = body.files

          const response = await runDifyApp(params.appId, payload)
          appendDifyAudit({
            action: 'dify_run',
            appId: params.appId,
            mode,
            outcome: 'success',
            status: response.status,
            durationMs: Date.now() - startedAt,
            clientIp: request.headers.get('x-real-ip') || undefined,
          })
          return new Response(response.body, {
            status: response.status,
            headers: difyJsonHeaders(response),
          })
        } catch (error) {
          if (error instanceof SyntaxError) {
            return json(
              { ok: false, error: 'Invalid JSON body' },
              { status: 400 },
            )
          }
          const response = difyErrorResponse(error)
          appendDifyAudit({
            action: 'dify_run',
            appId: params.appId,
            outcome: 'failure',
            status: response.status,
            durationMs: Date.now() - startedAt,
            errorCode: error instanceof Error ? error.name : 'unknown',
          })
          return response
        }
      },
    },
  },
})
