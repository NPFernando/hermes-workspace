import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated, requireLocalOrAuth } from '../../server/auth-middleware'
import { requireJsonContentType, safeErrorMessage } from '../../server/rate-limit'
import { getDifyIntegration, runDifyWorkflow } from '../../server/dify'

export const Route = createFileRoute('/api/dify-integration')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        return json({ ok: true, ...getDifyIntegration() })
      },
      POST: async ({ request }) => {
        if (!requireLocalOrAuth(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as { workflowId?: unknown; inputs?: unknown }
          const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : ''
          if (!workflowId) return json({ ok: false, error: 'workflowId is required.' }, { status: 400 })
          const result = await runDifyWorkflow(workflowId, body.inputs)
          return json({ ok: true, ...result, history: getDifyIntegration().history })
        } catch (error) {
          return json({ ok: false, error: safeErrorMessage(error), history: getDifyIntegration().history }, { status: 400 })
        }
      },
    },
  },
})
