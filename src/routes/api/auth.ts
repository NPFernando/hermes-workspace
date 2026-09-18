import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import {
  clearSessionCookie,
  createSessionCookie,
  generateSessionToken,
  getSessionTokenFromCookie,
  isPasswordProtectionEnabled,
  passwordRole,
  revokeSessionToken,
  storeSessionToken,
} from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

const AuthSchema = z.object({
  password: z.string().max(1000),
  rememberMe: z.boolean().optional(),
})

export const Route = createFileRoute('/api/auth')({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        const token = getSessionTokenFromCookie(request.headers.get('cookie'))
        if (token) revokeSessionToken(token)
        return json(
          { ok: true },
          { headers: { 'Set-Cookie': clearSessionCookie() } },
        )
      },
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        // If password protection is disabled, reject auth attempts
        if (!isPasswordProtectionEnabled()) {
          return json(
            { ok: false, error: 'Authentication not required' },
            { status: 400 },
          )
        }

        // Rate limit: max 5 auth attempts per minute per IP
        const ip = getClientIp(request)
        if (!rateLimit(`auth:${ip}`, 5, 60_000)) {
          return rateLimitResponse()
        }

        try {
          const raw = await request.json().catch(() => ({}))
          const parsed = AuthSchema.safeParse(raw)

          if (!parsed.success) {
            return json(
              { ok: false, error: 'Invalid request' },
              { status: 400 },
            )
          }

          const { password, rememberMe } = parsed.data

          // Resolve the least-privileged role without revealing which
          // credential was accepted.
          const role = passwordRole(password)

          if (!role) {
            // Add small delay to prevent brute force
            await new Promise((resolve) => setTimeout(resolve, 1000))
            return json(
              { ok: false, error: 'Invalid password' },
              { status: 401 },
            )
          }

          // Generate session token
          const token = generateSessionToken()
          storeSessionToken(token, rememberMe ?? true, role)

          // Return success with Set-Cookie header
          return json(
            { ok: true },
            {
              status: 200,
              headers: {
                'Set-Cookie': createSessionCookie(token, rememberMe ?? true),
              },
            },
          )
        } catch (err) {
          if (import.meta.env.DEV) console.error('[/api/auth] Error:', err)
          return json(
            { ok: false, error: 'Authentication failed' },
            { status: 500 },
          )
        }
      },
    },
  },
})
