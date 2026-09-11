import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  autoSweepLifecycle,
  getSwarmLifecycleStatus,
  notifyHandoffWritten,
  renewWorker,
  requestWorkerHandoff,
} from '../../server/swarm-lifecycle'
import { listSwarmWorkerIds } from '../../server/swarm-foundation'
import { isSwarmWorkerId } from '../../server/swarm-roster'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

type LifecyclePost = {
  action?: unknown
  workerId?: unknown
  responseMode?: unknown
}

export function summarizeLifecycleSweep(
  sweep: ReadonlyArray<{
    action: string
    result?: { ok: boolean }
  }>,
): {
  processed: number
  actions: Record<string, number>
  failed: number
} {
  return {
    processed: sweep.length,
    actions: sweep.reduce<Record<string, number>>((counts, item) => {
      counts[item.action] = (counts[item.action] ?? 0) + 1
      return counts
    }, {}),
    failed: sweep.filter((item) => item.result?.ok === false).length,
  }
}

function validWorkerId(value: unknown): string | null {
  return isSwarmWorkerId(value) ? value.trim() : null
}

export const Route = createFileRoute('/api/swarm-lifecycle')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`swarm-lifecycle:${getClientIp(request)}`, 60, 60_000)) {
          return rateLimitResponse()
        }
        const url = new URL(request.url)
        const requested = validWorkerId(url.searchParams.get('workerId'))
        const ids = requested ? [requested] : listSwarmWorkerIds()
        return json({
          ok: true,
          checkedAt: Date.now(),
          workers: ids.map((id) => getSwarmLifecycleStatus(id)),
        })
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`swarm-lifecycle:post:${getClientIp(request)}`, 30, 60_000)) {
          return rateLimitResponse()
        }
        let body: LifecyclePost
        try {
          body = (await request.json()) as LifecyclePost
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }
        const action = typeof body.action === 'string' ? body.action : ''
        const workerIdMaybe = validWorkerId(body.workerId)
        if (action === 'auto-sweep') {
          const targets = workerIdMaybe ? [workerIdMaybe] : listSwarmWorkerIds()
          const sweep = await autoSweepLifecycle(targets)
          if (body.responseMode === 'scheduler_ack') {
            return json({
              ok: true,
              action,
              ...summarizeLifecycleSweep(sweep),
            })
          }
          return json({ ok: true, action, sweep })
        }
        if (!workerIdMaybe)
          return json(
            { ok: false, error: 'workerId required' },
            { status: 400 },
          )
        const workerId = workerIdMaybe
        if (action === 'request-handoff') {
          const result = await requestWorkerHandoff(workerId)
          return json({ workerId, action, ...result })
        }
        if (action === 'renew') {
          const result = await renewWorker(workerId)
          return json({ workerId, action, ...result })
        }
        if (action === 'notify-handoff-written') {
          notifyHandoffWritten(workerId)
          return json({ ok: true, workerId, action })
        }
        return json({ ok: false, error: 'Unsupported action' }, { status: 400 })
      },
    },
  },
})
