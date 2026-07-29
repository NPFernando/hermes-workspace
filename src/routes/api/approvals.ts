/**
 * Approval API — create, list, and resolve workflow approvals.
 *
 * GET  /api/approvals             — list pending approvals (optional ?session_id= filter)
 * GET  /api/approvals?id=<id>     — get a specific approval
 * POST /api/approvals             — create a new approval request
 * POST /api/approvals/resolve     — resolve (approve/reject) an approval
 * GET  /api/approvals/pending     — get first pending approval for current session
 *
 * The chat UI uses this to poll for pending approvals and render them as
 * SelectionCard messages.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { safeErrorMessage } from '../../server/rate-limit'
import {
  createApproval,
  getApproval,
  listPendingApprovals,
  resolveApproval,
  getStats,
  type ApprovalOption,
} from '../../server/approvals-store'

export const Route = createFileRoute('/api/approvals')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const approvalId = url.searchParams.get('id')
        const sessionId = url.searchParams.get('session_id')

        try {
          if (approvalId) {
            const record = getApproval(approvalId)
            if (!record) {
              return json({ ok: false, error: 'Not found' }, { status: 404 })
            }
            return json({ ok: true, approval: record })
          }
          return json({
            ok: true,
            approvals: listPendingApprovals(sessionId ?? undefined),
            stats: getStats(),
          })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const body = (await request.json()) as {
            session_id?: string
            task_id?: string
            title?: string
            body?: string
            options?: Array<ApprovalOption>
            timeout_minutes?: number
          }

          if (!body.session_id) {
            return json(
              { ok: false, error: 'session_id is required' },
              { status: 400 },
            )
          }
          if (!body.title) {
            return json(
              { ok: false, error: 'title is required' },
              { status: 400 },
            )
          }
          if (!Array.isArray(body.options) || body.options.length === 0) {
            return json(
              { ok: false, error: 'options array is required' },
              { status: 400 },
            )
          }

          const record = createApproval({
            session_id: body.session_id,
            task_id: body.task_id ?? null,
            title: body.title,
            body: body.body ?? '',
            options: body.options,
            timeout_minutes: body.timeout_minutes,
          })

          return json({ ok: true, approval: record }, { status: 201 })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})