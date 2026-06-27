import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { runCompletionCheckBackground } from '../../server/astra-tasks'

export const Route = createFileRoute('/api/tasks-completion-check')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const result = runCompletionCheckBackground()
        return json({ ok: true, ...result })
      },
    },
  },
})
