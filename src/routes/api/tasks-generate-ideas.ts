import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { generateIdeasWithAI } from '../../server/astra-tasks'

export const Route = createFileRoute('/api/tasks-generate-ideas')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const result = generateIdeasWithAI()
        return json({ ok: result.injected > 0 || !result.error, ...result })
      },
    },
  },
})
