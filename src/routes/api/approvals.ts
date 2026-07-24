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

// ── Sub-route: /api/approvals/resolve ──────────────────────────────────────

export const ResolveRoute = createFileRoute('/api/approvals/resolve')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const body = (await request.json()) as {
            id?: string
            status?: 'approved' | 'rejected'
            response?: string
          }

          if (!body.id) {
            return json(
              { ok: false, error: 'id is required' },
              { status: 400 },
            )
          }
          if (
            body.status !== 'approved' &&
            body.status !== 'rejected'
          ) {
            return json(
              { ok: false, error: 'status must be "approved" or "rejected"' },
              { status: 400 },
            )
          }

          const record = resolveApproval(body.id, body.status, body.response)
          if (!record) {
            return json(
              { ok: false, error: 'Approval not found or already resolved' },
              { status: 404 },
            )
          }

          return json({ ok: true, approval: record })
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

// ── Sub-route: /api/approvals/pending ──────────────────────────────────────

export const PendingRoute = createFileRoute('/api/approvals/pending')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const url = new URL(request.url)
          const sessionId = url.searchParams.get('session_id')
          if (!sessionId) {
            return json(
              { ok: false, error: 'session_id query param required' },
              { status: 400 },
            )
          }

          const pending = listPendingApprovals(sessionId)
          if (pending.length === 0) {
            return json({ ok: true, pending: null })
          }

          return json({ ok: true, pending: pending[0] })
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