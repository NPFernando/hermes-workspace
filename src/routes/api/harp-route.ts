import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { planUniversalHarpRoute, type UniversalHarpRequest } from '../../server/universal-harp'

const risks = new Set<UniversalHarpRequest['risk']>(['trivial', 'low', 'standard', 'complex', 'high_risk', 'production', 'unknown'])
const dataClasses = new Set<UniversalHarpRequest['dataClass']>(['public', 'internal', 'confidential', 'secret', 'regulated'])
const actionModes = new Set<UniversalHarpRequest['actionMode']>(['read_only', 'write', 'review', 'deploy', 'interactive'])
const scopes = new Set<UniversalHarpRequest['scope']>(['snippet', 'file', 'module', 'repository', 'system', 'external'])
const runtimes = new Set<NonNullable<UniversalHarpRequest['runtime']>>(['auto', 'codex', 'claude', 'hermes'])

export const Route = createFileRoute('/api/harp-route')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, { status: 401 })
        let body: Partial<UniversalHarpRequest>
        try { body = await request.json() as Partial<UniversalHarpRequest> } catch { return json({ error: 'Invalid JSON body' }, { status: 400 }) }
        if (
          typeof body.taskFamily !== 'string' || !risks.has(body.risk as UniversalHarpRequest['risk']) ||
          !dataClasses.has(body.dataClass as UniversalHarpRequest['dataClass']) || !actionModes.has(body.actionMode as UniversalHarpRequest['actionMode']) ||
          !scopes.has(body.scope as UniversalHarpRequest['scope']) || typeof body.repoPath !== 'string' ||
          (body.runtime !== undefined && !runtimes.has(body.runtime)) ||
          (body.sessionOrigin !== undefined && !runtimes.has(body.sessionOrigin))
        ) return json({ error: 'Invalid Universal HARP route request' }, { status: 400 })
        const result = planUniversalHarpRoute(body as UniversalHarpRequest)
        return result.ok ? json({ ok: true, plan: result.plan }) : json({ ok: false, error: result.error }, { status: 503 })
      },
    },
  },
})
