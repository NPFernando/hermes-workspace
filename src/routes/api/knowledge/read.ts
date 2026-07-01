import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readKnowledgePage } from '../../../server/knowledge-browser'

import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/knowledge/read')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const pathParam = url.searchParams.get('path') || ''

        try {
          const { meta, content, backlinks } = readKnowledgePage(pathParam)
          return json({ page: meta, content, backlinks })
        } catch (error) {
          const message =
            safeErrorMessage(error)
          const status =
            /not allowed|outside knowledge root|required|traversal/i.test(
              message,
            )
              ? 400
              : /ENOENT/.test(message)
                ? 404
                : 500
          return json({ error: message }, { status })
        }
      },
    },
  },
})
