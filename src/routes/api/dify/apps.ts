import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getDifyAppKey, getDifyConfig } from '../../../server/dify-config'

export const Route = createFileRoute('/api/dify/apps')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const config = getDifyConfig()
        return json({
          ok: true,
          apps: config.apps
            .filter((app) => app.enabled !== false)
            .map((app) => ({
              id: app.id,
              label: app.label,
              configured: Boolean(getDifyAppKey(app)),
              enabled: true,
            })),
        })
      },
    },
  },
})
