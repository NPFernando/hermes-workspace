import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated, requireLocalOrAuth } from '../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import {
  deleteWorkflowTemplate,
  readWorkflowTemplates,
  upsertWorkflowTemplate,
  writeWorkflowTemplates,
} from '../../server/workflow-templates-store'

export const Route = createFileRoute('/api/workflow-templates')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          return json({ ok: true, templates: readWorkflowTemplates() })
        } catch (error) {
          return json(
            { ok: false, error: safeErrorMessage(error) },
            { status: 500 },
          )
        }
      },

      POST: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = (await request.json()) as { template?: unknown }
          const template = upsertWorkflowTemplate(body.template)
          if (!template) {
            return json(
              { ok: false, error: 'Invalid workflow template' },
              { status: 400 },
            )
          }
          return json({
            ok: true,
            template,
            templates: readWorkflowTemplates(),
          })
        } catch (error) {
          return json(
            { ok: false, error: safeErrorMessage(error) },
            { status: 500 },
          )
        }
      },

      PUT: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = (await request.json()) as { templates?: unknown }
          if (!Array.isArray(body.templates)) {
            return json(
              { ok: false, error: 'templates must be an array' },
              { status: 400 },
            )
          }
          const templates = writeWorkflowTemplates(body.templates)
          return json({ ok: true, templates })
        } catch (error) {
          return json(
            { ok: false, error: safeErrorMessage(error) },
            { status: 500 },
          )
        }
      },

      DELETE: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = (await request.json()) as { id?: unknown }
          const id = typeof body.id === 'string' ? body.id.trim() : ''
          if (!id) {
            return json({ ok: false, error: 'id is required' }, { status: 400 })
          }
          const deleted = deleteWorkflowTemplate(id)
          return json({ ok: true, deleted, templates: readWorkflowTemplates() })
        } catch (error) {
          return json(
            { ok: false, error: safeErrorMessage(error) },
            { status: 500 },
          )
        }
      },
    },
  },
})
