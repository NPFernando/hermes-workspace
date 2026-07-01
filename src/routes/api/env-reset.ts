/**
 * POST /api/env-reset
 *
 * Clears workspace-side caches and forces a fresh gateway probe.
 * Useful when the agent restarts, models change, or the UI gets stuck
 * showing stale connection state.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { forceReprobeGateway } from '../../server/gateway-capabilities'
import { clearProbe, listProbes } from '../../server/mcp-tools-cache'

import { safeErrorMessage } from '../../server/rate-limit'

export const Route = createFileRoute('/api/env-reset')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        // 1. Clear MCP tools probes so next load re-tests each server
        const probeNames = Array.from(listProbes().keys())
        for (const name of probeNames) {
          clearProbe(name)
        }

        // 2. Force-reprobe the gateway — clears cached capability state
        let capabilities: Awaited<ReturnType<typeof forceReprobeGateway>> | null = null
        let gatewayError: string | null = null
        try {
          capabilities = await forceReprobeGateway()
        } catch (err) {
          gatewayError = safeErrorMessage(err)
        }

        return json({
          ok: true,
          mcpProbesCleared: probeNames.length,
          gateway: capabilities
            ? { available: capabilities.health || capabilities.chatCompletions }
            : { available: false, error: gatewayError },
        })
      },
    },
  },
})
