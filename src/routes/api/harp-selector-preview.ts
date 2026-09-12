import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { loadHarpSelectorPreview } from '../../server/harp-selector-preview'

export const Route = createFileRoute('/api/harp-selector-preview')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const preview = await loadHarpSelectorPreview()
          return json({ ok: true, ...preview })
        } catch {
          return json(
            { ok: false, error: 'HARP selector preview is unavailable' },
            { status: 503 },
          )
        }
      },
    },
  },
})
