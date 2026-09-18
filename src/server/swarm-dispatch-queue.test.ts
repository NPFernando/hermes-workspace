import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import {
  buildSwarmDispatchQueueNotification,
  cancelSwarmDispatchQueueJob,
  closeSwarmDispatchQueuePool,
  enqueueSwarmDispatch,
  getSwarmDispatchQueueJob,
  getSwarmDispatchQueueSnapshot,
  normalizeSwarmDispatchPriority,
  retrySwarmDispatchQueueJob,
  runSwarmDispatchQueueCycle
} from './swarm-dispatch-queue'
import type {
  QueueProcessor,
  SwarmDispatchQueueIdempotencyError,
  SwarmDispatchQueueRetryError,
} from './swarm-dispatch-queue'

const database = process.env.SWARM_QUEUE_PG_DATABASE ?? ''
const integrationRequested = process.env.RUN_SWARM_QUEUE_PG_INTEGRATION === '1'
const pgHost = process.env.HERMES_PG_HOST ?? ''
const integrationEnabled =
  integrationRequested &&
  /_test$/i.test(database) &&
  ['127.0.0.1', 'localhost', '::1'].includes(pgHost) &&
  Boolean(process.env.HERMES_PG_PASSWORD) &&
  Boolean(process.env.HERMES_PG_USER)
if (integrationRequested && !integrationEnabled) {
  throw new Error(
    'Queue Postgres integration requires explicit credentials, a loopback host, and a *_test database.',
  )
}
const pgDescribe = describe.skipIf(!integrationEnabled)

describe('swarm dispatch queue priority validation', () => {
  it('defaults missing priority and accepts the bounded range', () => {
    expect(normalizeSwarmDispatchPriority(undefined)).toBe(0)
    expect(normalizeSwarmDispatchPriority(9)).toBe(9)
  })

  it.each([-1, 1.5, 10, '9', null])('rejects invalid priority %s', (value) => {
    expect(() => normalizeSwarmDispatchPriority(value)).toThrow(
      'Queue priority must be an integer',
    )
  })
})

describe('swarm dispatch queue terminal notifications', () => {
  it('builds a dead-letter notification with a safe default session', () => {
    expect(
      buildSwarmDispatchQueueNotification({
        id: 'job-123',
        status: 'failed',
        error: 'agent failed',
      }),
    ).toMatchObject({
      sessionKey: 'main',
      title: 'Serial dispatch failed',
      details: {
        source: 'swarm-dispatch-queue',
        queueId: 'job-123',
        status: 'failed',
      },
    })
  })

  it('does not notify for successful or intentionally cancelled jobs', () => {
    expect(
      buildSwarmDispatchQueueNotification({
        id: 'job-123',
        status: 'succeeded',
        error: null,
      }),
    ).toBeNull()
    expect(
      buildSwarmDispatchQueueNotification({
        id: 'job-123',
        status: 'cancelled',
        error: null,
      }),
    ).toBeNull()
  })
})

pgDescribe('Postgres-backed serial dispatch queue', () => {
  const inspectionPool = new Pool({
    host: pgHost,
    port: Number(process.env.HERMES_PG_PORT),
    user: process.env.HERMES_PG_USER,
    password: process.env.HERMES_PG_PASSWORD,
    database,
    max: 2,
  })

  beforeAll(async () => {
    if (!/_test$/i.test(database))
      throw new Error('Queue integration tests require a *_test database.')
    await inspectionPool.query(
      'TRUNCATE TABLE public.swarm_dispatch_queue_retry_audits, public.swarm_dispatch_queue_jobs',
    )
  })

  it('orders higher-priority jobs first and preserves FIFO within a priority', async () => {
    const normal = await enqueueSwarmDispatch({ label: 'normal' }, 1)
    const high = await enqueueSwarmDispatch({ label: 'high' }, 1, undefined, 9)
    const highLater = await enqueueSwarmDispatch(
      { label: 'high-later' },
      1,
      undefined,
      9,
    )
    const order: Array<string> = []
    await runSwarmDispatchQueueCycle(async (payload) => {
      order.push(String(payload.label))
      return { results: [{ ok: true }] }
    })
    expect(order).toEqual(['high', 'high-later', 'normal'])
  })

  afterAll(async () => {
    await inspectionPool.end()
    await closeSwarmDispatchQueuePool()
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
  }, 10_000)

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
    await expect(getSwarmDispatchQueueJob(first.id)).resolves.toMatchObject({
      status: 'succeeded',
    })
    await expect(getSwarmDispatchQueueJob(second.id)).resolves.toMatchObject({
      status: 'succeeded',
    })
  })

  it('deduplicates concurrent submissions and rejects key reuse with a different payload', async () => {
    const key = 'isolated-duplicate-submission-key'
    const payload = { label: 'same-logical-submit', dispatchMode: 'serial' }
    const submissions = await Promise.all([
      enqueueSwarmDispatch(payload, 1, key),
      enqueueSwarmDispatch(payload, 1, key),
    ])
    expect(submissions[0].id).toBe(submissions[1].id)
    expect(
      submissions.map((submission) => submission.alreadyQueued).sort(),
    ).toEqual([false, true])
    await expect(
      enqueueSwarmDispatch({ label: 'different-payload' }, 1, key),
    ).rejects.toMatchObject({
      name: 'SwarmDispatchQueueIdempotencyError',
      kind: 'payload-conflict',
    } satisfies Partial<SwarmDispatchQueueIdempotencyError>)
    const matchingRows = await inspectionPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.swarm_dispatch_queue_jobs
       WHERE submission_key = $1`,
      [key],
    )
    expect(Number(matchingRows.rows[0]?.count)).toBe(1)
    await cancelSwarmDispatchQueueJob(submissions[0].id)
  })

  it('prevents two independent worker processes from processing a batch twice', async () => {
    const first = await enqueueSwarmDispatch({ label: 'process-a' }, 1)
    const second = await enqueueSwarmDispatch({ label: 'process-b' }, 1)
    const workerScript = fileURLToPath(
      new URL('../../scripts/swarm-queue-test-worker.mjs', import.meta.url),
    )

    const runProcess = (workerId: string) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', workerScript],
          {
            env: { ...process.env, QUEUE_TEST_WORKER_ID: workerId },
            stdio: 'ignore',
          },
        )
        child.once('error', reject)
        child.once('exit', (code) => {
          if (code === 0) resolve()
          else
            reject(
              new Error(
                `Queue test worker ${workerId} exited with code ${code}`,
              ),
            )
        })
      })

    await Promise.all([runProcess('worker-a'), runProcess('worker-b')])

    const jobs = await Promise.all([
      getSwarmDispatchQueueJob(first.id),
      getSwarmDispatchQueueJob(second.id),
    ])
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'succeeded',
          result: { worker: expect.stringMatching(/^worker-[ab]$/) },
        }),
        expect.objectContaining({
          status: 'succeeded',
          result: { worker: expect.stringMatching(/^worker-[ab]$/) },
        }),
      ]),
    )
    const resultsBefore = jobs.map((job) => job?.result)
    await runSwarmDispatchQueueCycle(async () => ({
      worker: 'unexpected-replay',
    }))
    const resultsAfter = await Promise.all([
      getSwarmDispatchQueueJob(first.id),
      getSwarmDispatchQueueJob(second.id),
    ])
    expect(resultsAfter.map((job) => job?.result)).toEqual(resultsBefore)
  })

  it('keeps processor failures terminal instead of blindly replaying them', async () => {
    const queued = await enqueueSwarmDispatch({ label: 'terminal-failure' }, 1)
    const processor = vi.fn(async () => {
      throw new Error('synthetic test failure')
    })
    await runSwarmDispatchQueueCycle(processor)
    await expect(getSwarmDispatchQueueJob(queued.id)).resolves.toMatchObject({
      status: 'failed',
      deadLetterAt: expect.any(Number),
    })

    await runSwarmDispatchQueueCycle(async () => ({ results: [{ ok: true }] }))
    await expect(getSwarmDispatchQueueJob(queued.id)).resolves.toMatchObject({
      status: 'failed',
    })
    expect(processor).toHaveBeenCalledTimes(1)
  })

  it('requires explicit duplicate-risk acknowledgement and makes manual retries idempotent', async () => {
    const original = await enqueueSwarmDispatch({ label: 'reviewed-retry' }, 1)
    await runSwarmDispatchQueueCycle(async () => {
      throw new Error('synthetic isolated failure')
    })

    await expect(
      retrySwarmDispatchQueueJob(original.id, false, {
        operator: 'test-operator',
        note: 'Reviewed isolated retry for test.',
      }),
    ).rejects.toMatchObject({
      name: 'SwarmDispatchQueueRetryError',
      kind: 'acknowledgement-required',
    } satisfies Partial<SwarmDispatchQueueRetryError>)
    const retried = await retrySwarmDispatchQueueJob(original.id, true, {
      operator: 'test-operator',
      note: 'Reviewed isolated retry for test.',
    })
    expect(retried).toMatchObject({
      retryOfJobId: original.id,
      position: 1,
      alreadyQueued: false,
    })

    const duplicateRequest = await retrySwarmDispatchQueueJob(original.id, true, {
      operator: 'test-operator',
      note: 'Reviewed duplicate request for test.',
    })
    expect(duplicateRequest).toMatchObject({
      id: retried.id,
      retryOfJobId: original.id,
      alreadyQueued: true,
    })
    const audits = await inspectionPool.query<{
      operator: string
      approval_note: string
      already_queued: boolean
    }>(
      `SELECT operator, approval_note, already_queued
       FROM public.swarm_dispatch_queue_retry_audits
       WHERE source_job_id = $1::uuid ORDER BY approved_at`,
      [original.id],
    )
    expect(audits.rows).toMatchObject([
      {
        operator: 'test-operator',
        approval_note: 'Reviewed isolated retry for test.',
        already_queued: false,
      },
      {
        operator: 'test-operator',
        approval_note: 'Reviewed duplicate request for test.',
        already_queued: true,
      },
    ])
    const snapshot = await getSwarmDispatchQueueSnapshot()
    expect(
      snapshot.waiting.filter((job) => job.retryOfJobId === original.id),
    ).toHaveLength(1)

    await runSwarmDispatchQueueCycle(async () => ({ results: [{ ok: true }] }))
    await expect(getSwarmDispatchQueueJob(retried.id)).resolves.toMatchObject({
      status: 'succeeded',
      retryOfJobId: original.id,
      deadLetterAt: null,
    })
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
      if ((await getSwarmDispatchQueueJob(queued.id))?.status === 'running')
        break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect((await getSwarmDispatchQueueJob(queued.id))?.status).toBe('running')
    const firstLeaseExpiry = (await getSwarmDispatchQueueJob(queued.id))
      ?.leaseExpiresAt
    expect(firstLeaseExpiry).toEqual(expect.any(Number))
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    const renewedLeaseExpiry = (await getSwarmDispatchQueueJob(queued.id))
      ?.leaseExpiresAt
    expect(renewedLeaseExpiry).toBeGreaterThan(firstLeaseExpiry ?? 0)
    await cancelSwarmDispatchQueueJob(queued.id)
    await cycle

    expect(observedSignal?.aborted).toBe(true)
    await expect(getSwarmDispatchQueueJob(queued.id)).resolves.toMatchObject({
      status: 'cancelled',
    })
  })

  it('settles completion-versus-cancellation races into one terminal state', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const queued = await enqueueSwarmDispatch(
        { label: `cancel-complete-race-${attempt}` },
        1,
      )
      let announceStarted!: () => void
      let releaseCompletion!: () => void
      const started = new Promise<void>((resolve) => {
        announceStarted = resolve
      })
      const completionGate = new Promise<void>((resolve) => {
        releaseCompletion = resolve
      })
      const cycle = runSwarmDispatchQueueCycle(async () => {
        announceStarted()
        await completionGate
        return { results: [{ ok: true }] }
      })

      await started
      const [cancelResult] = await Promise.all([
        cancelSwarmDispatchQueueJob(queued.id),
        Promise.resolve().then(releaseCompletion),
      ])
      await cycle

      const settled = await getSwarmDispatchQueueJob(queued.id)
      expect(settled?.status).toMatch(/^(cancelled|succeeded)$/)
      expect(settled?.leaseExpiresAt).toBeNull()
      expect(settled?.deadLetterAt).toBeNull()
      expect(cancelResult.status).toMatch(/^(running|succeeded|cancelled)$/)
    }
  })

  it('marks abandoned running work interrupted after restart and continues with pending jobs', async () => {
    const interrupted = await enqueueSwarmDispatch({ label: 'abandoned' }, 1)
    await inspectionPool.query(
      `UPDATE public.swarm_dispatch_queue_jobs
       SET status = 'running', started_at = clock_timestamp(),
           lease_token = gen_random_uuid(),
           lease_expires_at = clock_timestamp() - interval '1 second'
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
    await expect(
      getSwarmDispatchQueueJob(interrupted.id),
    ).resolves.toMatchObject({
      status: 'interrupted',
      error: expect.stringContaining('verify agent state before retrying'),
    })
    await expect(getSwarmDispatchQueueJob(next.id)).resolves.toMatchObject({
      status: 'succeeded',
    })
  })
})
