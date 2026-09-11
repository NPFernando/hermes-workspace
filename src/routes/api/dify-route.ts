import { createHash } from 'node:crypto'
import { json } from '@tanstack/react-start'
import { DifyClientError } from './dify-client'
import { appendDifyAudit } from './dify-audit'
import { getDifyApp, getDifyConfig } from './dify-config'
import { getSessionTokenFromCookie } from './auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from './rate-limit'

export function difyErrorResponse(error: unknown) {
  if (error instanceof DifyClientError) {
    return json(
      { ok: false, code: error.code, error: error.message },
      { status: error.status },
    )
  }
  return json(
    { ok: false, code: 'dify_error', error: 'Dify request failed' },
    { status: 502 },
  )
}

export function difyJsonHeaders(response: Response): Headers {
  const headers = new Headers()
  const contentType = response.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  return headers
}

export function enforceDifyRateLimit(
  request: Request,
  appId: string,
  operation: string,
): Response | null {
  const configured = Number.parseInt(process.env.DIFY_RATE_LIMIT ?? '20', 10)
  const registered = getDifyApp(appId, getDifyConfig())
  const maxRequests =
    registered?.rateLimit ??
    (Number.isFinite(configured) && configured > 0 ? configured : 20)
  const key = `dify:${operation}:${appId}:${getClientIp(request)}`
  if (rateLimit(key, maxRequests, 10 * 60_000)) return null
  appendDifyAudit({
    action: `dify_${operation}`,
    appId,
    outcome: 'rate_limited',
    status: 429,
    clientIp: getClientIp(request),
  })
  return rateLimitResponse()
}

export function requireDifyJson(request: Request): Response | null {
  return requireJsonContentType(request)
}

/**
 * Return a stable, opaque Dify user identifier for this browser session.
 * Dify uses `user` as its conversation partition key; using one global value
 * would merge conversations between authenticated sessions. Never forward the
 * raw Hermes session token to Dify.
 */
export function getDifyUserId(request: Request): string {
  const token = getSessionTokenFromCookie(request.headers.get('cookie'))
  if (!token) return 'hermes-workspace'
  return `hermes-${createHash('sha256').update(token).digest('hex').slice(0, 32)}`
}

export { appendDifyAudit }
