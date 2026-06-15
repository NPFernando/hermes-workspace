import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { readUserSettings, writeUserSettings } from '../../server/user-settings'

export const Route = createFileRoute('/api/user-settings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        return json(readUserSettings())
      },
      PUT: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const body = (await request.json()) as Record<string, unknown>
          writeUserSettings(body)
          return json(readUserSettings())
        } catch {
          return json({ error: 'Invalid request' }, { status: 400 })
        }
      },
    },
  },
})
