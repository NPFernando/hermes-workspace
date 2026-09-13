import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import {
  cancelSwarmDispatchQueueJob,
  enqueueSwarmDispatch,
  getSwarmDispatchQueueJob,
  getSwarmDispatchQueueSnapshot,
  runSwarmDispatchQueueCycle,
  type QueueProcessor,
} from './swarm-dispatch-queue'

const database = process.env.SWARM_QUEUE_PG_DATABASE ?? ''
const integrationEnabled =
  process.env.RUN_SWARM_QUEUE_PG_INTEGRATION === '1' && /_test$/i.test(database)
const pgDescribe = describe.skipIf(!integrationEnabled)

function readPgSettings(): Record<string, string> {
  const home = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes')
  const values: Record<string, string> = {}
  for (const line of readFileSync(join(home, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^HERMES_PG_(PASSWORD|HOST|PORT|USER)=(.*)$/)
    if (match) values[match[1]] = match[2].trim().replace(/^"|"$/g, '')
  }
  return values
}

pgDescribe('Postgres-backed serial dispatch queue', () => {
  const settings = readPgSettings()
  const inspectionPool = new Pool({
    host: process.env.HERMES_PG_HOST ?? settings.HOST ?? '127.0.0.1',
    port: Number(process.env.HERMES_PG_PORT ?? settings.PORT ?? '5432'),
    user: process.env.HERMES_PG_USER ?? settings.USER ?? 'hermes_app',
    password: process.env.HERMES_PG_PASSWORD ?? settings.PASSWORD,
    database,
    max: 2,
  })

  beforeAll(async () => {
    if (!/_test$/i.test(database)) throw new Error('Queue integration tests require a *_test database.')
    await inspectionPool.query('DELETE FROM public.swarm_dispatch_queue_jobs')
  })

  afterAll(async () => {
    await inspectionPool.end()
  })

  it('persists queued state and allows pending jobs to be cancelled', async () => {
    const queued = await enqueueSwarmDispatch({ label: 'pending-cancel' }, 2)
    const stored = await getSwarmDispatchQueueJob(queued.id)
    expect(stored).toMatchObject({
      id: queued.id,
      status: 'pending',
      assignmentCount: 2,
      payload: { label: 'pending-cancel' },
    })

    const snapshot = await getSwarmDispatchQueueSnapshot()
    expect(snapshot.mode).toBe('postgres')
    expect(snapshot.waiting.some((job) => job.id === queued.id)).toBe(true)
    expect(snapshot.waiting[0].position).toBe(1)

    await expect(cancelSwarmDispatchQueueJob(queued.id)).resolves.toEqual({
      found: true,
      status: 'cancelled',
    })
    await expect(getSwarmDispatchQueueJob(queued.id)).resolves.toMatchObject({
      status: 'cancelled',
    })
  })

  it('serializes concurrent workers with the shared Postgres advisory lock and preserves FIFO order', async () => {
    const first = await enqueueSwarmDispatch({ label: 'first' }, 1)
    const second = await enqueueSwarmDispatch({ label: 'second' }, 1)
    const order: Array<string> = []
    let active = 0
    let peak = 0
    const processor: QueueProcessor = async (payload) => {
      active += 1
      peak = Math.max(peak, active)
      order.push(String(payload.label))
      await new Promise((resolve) => setTimeout(resolve, 30))
      active -= 1
      return { results: [{ ok: true }] }
    }

    await Promise.all([
      runSwarmDispatchQueueCycle(processor),
      runSwarmDispatchQueueCycle(processor),
    ])

    expect(order).toEqual(['first', 'second'])
    expect(peak).toBe(1)
    await expect(getSwarmDispatchQueueJob(first.id)).resolves.toMatchObject({ status: 'succeeded' })
    await expect(getSwarmDispatchQueueJob(second.id)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('interrupts active work when cancellation is requested', async () => {
    const queued = await enqueueSwarmDispatch({ label: 'active-cancel' }, 1)
    let observedSignal: AbortSignal | undefined
    const cycle = runSwarmDispatchQueueCycle(async (_payload, { signal }) => {
      observedSignal = signal
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return { results: [] }
    })

    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if ((await getSwarmDispatchQueueJob(queued.id))?.status === 'running') break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect((await getSwarmDispatchQueueJob(queued.id))?.status).toBe('running')
    await cancelSwarmDispatchQueueJob(queued.id)
    await cycle

    expect(observedSignal?.aborted).toBe(true)
    await expect(getSwarmDispatchQueueJob(queued.id)).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('marks abandoned running work interrupted after restart and continues with pending jobs', async () => {
    const interrupted = await enqueueSwarmDispatch({ label: 'abandoned' }, 1)
    await inspectionPool.query(
      `UPDATE public.swarm_dispatch_queue_jobs
       SET status = 'running', started_at = clock_timestamp()
       WHERE id = $1::uuid`,
      [interrupted.id],
    )
    const next = await enqueueSwarmDispatch({ label: 'after-restart' }, 1)
    const processed: Array<string> = []
    await runSwarmDispatchQueueCycle(async (payload) => {
      processed.push(String(payload.label))
      return { results: [{ ok: true }] }
    })

    expect(processed).toEqual(['after-restart'])
    await expect(getSwarmDispatchQueueJob(interrupted.id)).resolves.toMatchObject({
      status: 'interrupted',
      error: expect.stringContaining('verify agent state before retrying'),
    })
    await expect(getSwarmDispatchQueueJob(next.id)).resolves.toMatchObject({ status: 'succeeded' })
  })
})
