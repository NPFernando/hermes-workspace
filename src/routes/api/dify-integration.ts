import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  isAuthenticated,
  requireLocalOrAuth,
} from '../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import {
  compareDifyWorkflowVersions,
  getDifyIntegration,
  rollbackDifyWorkflow,
  runDifyWorkflow,
} from '../../server/dify'
import { ExternalWriteBlockedError } from '../../server/safe-mode'

export const Route = createFileRoute('/api/dify-integration')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        return json({ ok: true, ...getDifyIntegration() })
      },
      POST: async ({ request }) => {
        if (!requireLocalOrAuth(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as {
            action?: unknown
            workflowId?: unknown
            inputs?: unknown
            fromVersion?: unknown
            toVersion?: unknown
            version?: unknown
            note?: unknown
          }
          const workflowId =
            typeof body.workflowId === 'string' ? body.workflowId.trim() : ''
          if (!workflowId)
            return json(
              { ok: false, error: 'workflowId is required.' },
              { status: 400 },
            )
          const action = typeof body.action === 'string' ? body.action : 'run'
          if (action === 'compare') {
            const fromVersion =
              typeof body.fromVersion === 'string'
                ? body.fromVersion.trim()
                : ''
            const toVersion =
              typeof body.toVersion === 'string' ? body.toVersion.trim() : ''
            if (!fromVersion || !toVersion)
              return json(
                {
                  ok: false,
                  error: 'fromVersion and toVersion are required.',
                },
                { status: 400 },
              )
            return json({
              ok: true,
              comparison: compareDifyWorkflowVersions(
                workflowId,
                fromVersion,
                toVersion,
              ),
            })
          }
          if (action === 'rollback') {
            const version =
              typeof body.version === 'string' ? body.version.trim() : ''
            const note = typeof body.note === 'string' ? body.note : ''
            if (!version)
              return json(
                { ok: false, error: 'version is required.' },
                { status: 400 },
              )
            return json({
              ok: true,
              ...rollbackDifyWorkflow(workflowId, version, note),
            })
          }
          if (action !== 'run')
            return json(
              { ok: false, error: 'Unsupported Dify action.' },
              { status: 400 },
            )
          const result = await runDifyWorkflow(
            workflowId,
            body.inputs,
            fetch,
            undefined,
            { signal: request.signal },
          )
          return json({
            ok: true,
            ...result,
            history: getDifyIntegration().history,
          })
        } catch (error) {
          return json(
            {
              ok: false,
              error: safeErrorMessage(error),
              history: getDifyIntegration().history,
            },
            {
              status: error instanceof ExternalWriteBlockedError ? 423 : 400,
            },
          )
        }
      },
    },
  },
})
