import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listMemoryFiles } from '../../../server/memory-browser'

import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/memory/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        // Memory is sourced entirely from local filesystem via memory-browser.ts
        // (reads $HERMES_HOME/MEMORY.md + $HERMES_HOME/memory/ + /memories/). No
        // remote gateway endpoint is required, so no capability gate is needed.
        try {
          return json({ files: listMemoryFiles() })
        } catch (error) {
          return json(
            {
              error:
                safeErrorMessage(error),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
