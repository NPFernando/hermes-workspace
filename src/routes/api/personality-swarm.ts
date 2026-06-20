import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  PERSONALITY_PRESETS,
  applyPersonalityToSwarm,
  getSwarmPersonalityRecommendations,
} from '../../server/personality-swarm-store'
import type { ApplyPersonalitySwarmOptions } from '../../server/personality-swarm-store'

export const Route = createFileRoute('/api/personality-swarm')({
  server: {
    handlers: {
      /** GET — return preset catalogue + swarm recommendations */
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({
          ok: true,
          presets: Object.entries(PERSONALITY_PRESETS).map(([key, p]) => ({
            key,
            name: p.name,
            label: p.label,
            description: p.description,
            prompt: p.prompt,
          })),
          recommendations: getSwarmPersonalityRecommendations(),
        })
      },

      /** POST — apply personality + optional swarm distribution */
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        let body: ApplyPersonalitySwarmOptions
        try {
          body = (await request.json()) as ApplyPersonalitySwarmOptions
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.primaryPersonality.trim()) {
          return json({ ok: false, error: 'primaryPersonality is required' }, { status: 400 })
        }
        const result = applyPersonalityToSwarm(body)
        return json({ ok: result.ok, applied: result.applied, error: result.error })
      },
    },
  },
})
