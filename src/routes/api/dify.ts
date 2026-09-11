import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { probeDify } from '../../server/dify-client'
import { getDifyAppKey, getDifyConfig } from '../../server/dify-config'

export const Route = createFileRoute('/api/dify')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const config = getDifyConfig()
        const status = await probeDify()
        const enabledApps = config.apps.filter((app) => app.enabled !== false)
        const appKeysConfigured = enabledApps.filter((app) =>
          Boolean(getDifyAppKey(app)),
        ).length
        const reason =
          config.errors.length > 0
            ? 'configuration_invalid'
            : !config.enabled
              ? 'disabled'
              : enabledApps.length === 0
                ? 'no_apps'
                : appKeysConfigured === 0
                  ? 'missing_credentials'
                  : !status.reachable
                    ? 'unreachable'
                    : 'connected'
        return json({
          ok: true,
          enabled: config.enabled,
          baseUrl: config.enabled ? config.baseUrl : null,
          configured: status.configured,
          reachable: status.reachable,
          apps: status.apps,
          appKeysConfigured,
          reason,
          configErrors: config.errors,
          rateLimitPerWindow: Number.parseInt(
            process.env.DIFY_RATE_LIMIT ?? '20',
            10,
          ),
        })
      },
    },
  },
})
