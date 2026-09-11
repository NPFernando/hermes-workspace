import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { readUserSettings, writeUserSettings } from '../../server/user-settings'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

const PRIVATE_SETTINGS_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Vary: 'Cookie',
}

export const Route = createFileRoute('/api/user-settings')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json(
            { error: 'Unauthorized' },
            { status: 401, headers: PRIVATE_SETTINGS_HEADERS },
          )
        }
        return json(readUserSettings(), { headers: PRIVATE_SETTINGS_HEADERS })
      },
      PUT: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json(
            { error: 'Unauthorized' },
            { status: 401, headers: PRIVATE_SETTINGS_HEADERS },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`user-settings-write:${getClientIp(request)}`, 30, 60_000)) {
          return rateLimitResponse()
        }
        try {
          const body = (await request.json()) as Record<string, unknown>
          writeUserSettings(body)
          return json(readUserSettings(), { headers: PRIVATE_SETTINGS_HEADERS })
        } catch {
          return json(
            { error: 'Invalid request' },
            { status: 400, headers: PRIVATE_SETTINGS_HEADERS },
          )
        }
      },
    },
  },
})
