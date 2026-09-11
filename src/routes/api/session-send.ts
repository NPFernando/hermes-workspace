/**
 * ControlSuite-compatible session-send adapter.
 *
 * Operations sends { sessionKey, message } and expects { ok: true } quickly.
 * We forward to the local /api/send-stream endpoint and discard the body
 * (the Operations chat panel polls /api/history at 5s intervals to pick up
 * the reply, so we don't need to hold the stream open here).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'

const MAX_SESSION_KEY_LENGTH = 512
const MAX_MESSAGE_LENGTH = 200_000

export type SessionSendInput = {
  sessionKey: string
  message: string
}

export function validateSessionSendInput(
  body: unknown,
): { ok: true; input: SessionSendInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Invalid request body' }
  }

  const candidate = body as { sessionKey?: unknown; message?: unknown }
  const sessionKey =
    typeof candidate.sessionKey === 'string' ? candidate.sessionKey.trim() : ''
  const message =
    typeof candidate.message === 'string' ? candidate.message.trim() : ''

  if (!sessionKey) return { ok: false, error: 'sessionKey is required' }
  if (!message) return { ok: false, error: 'message is required' }
  if (sessionKey.length > MAX_SESSION_KEY_LENGTH) {
    return { ok: false, error: 'sessionKey is too long' }
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: 'message is too long' }
  }

  return { ok: true, input: { sessionKey, message } }
}

export const Route = createFileRoute('/api/session-send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        if (!rateLimit(`session-send:${getClientIp(request)}`, 60, 60_000)) {
          return rateLimitResponse()
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const validation = validateSessionSendInput(await request.json())
          if (!validation.ok) {
            return json(
              { ok: false, error: validation.error },
              { status: 400 },
            )
          }
          const { sessionKey, message } = validation.input
          // Fire-and-forget: kick off the stream, then return. Operations
          // chat panel polls /api/session-history for new assistant turns.
          //
          // Use loopback rather than `request.url` so the internal hop never
          // leaves the host. Going back through a public hostname + reverse
          // proxy can drop the session cookie (SameSite / forbidden-header
          // handling differs across Node fetch implementations), which could
          // otherwise make the downstream call fail silently.
          const internalPort = process.env.PORT || '3000'
          const url = new URL(
            '/api/send-stream',
            `http://127.0.0.1:${internalPort}`,
          )
          const cookie = request.headers.get('cookie') || ''
          fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify({
              sessionKey,
              message,
            }),
          }).catch(() => {
            // swallow; UI discovers failures via next /api/session-history poll
          })
          return json({ ok: true, sessionKey, queued: true })
        } catch (error) {
          return json(
            {
              ok: false,
              error: safeErrorMessage(error),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
