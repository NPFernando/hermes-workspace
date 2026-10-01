import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SwarmDispatchQueueRetryError,
  retrySwarmDispatchQueueJob,
} from '../../server/swarm-dispatch-queue'
import { Route } from './swarm-dispatch'

const state = vi.hoisted(() => ({ authenticated: false }))
const queue = vi.hoisted(() => ({
  retry: vi.fn(),
  snapshot: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  start: vi.fn(),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => state.authenticated),
}))

vi.mock('../../server/swarm-dispatch-queue', () => {
  class SwarmDispatchQueueRetryError extends Error {
    constructor(
      readonly kind: 'acknowledgement-required' | 'not-found' | 'not-retryable',
      message: string,
    ) {
      super(message)
    }
  }
  class SwarmDispatchQueueFullError extends Error {}
  class SwarmDispatchQueueIdempotencyError extends Error {
    constructor(
      readonly kind: 'invalid-key' | 'payload-conflict',
      message: string,
    ) {
      super(message)
    }
  }
  class SwarmDispatchQueueUnavailableError extends Error {}

  return {
    SwarmDispatchQueueRetryError,
    SwarmDispatchQueueFullError,
    SwarmDispatchQueueIdempotencyError,
    SwarmDispatchQueueUnavailableError,
    retrySwarmDispatchQueueJob: queue.retry,
    getSwarmDispatchQueueSnapshot: queue.snapshot,
    cancelSwarmDispatchQueueJob: queue.cancel,
    pauseSwarmDispatchQueueJob: queue.pause,
    resumeSwarmDispatchQueueJob: queue.resume,
    startSwarmDispatchQueueWorker: queue.start,
    enqueueSwarmDispatch: vi.fn(),
    waitForSwarmDispatchQueueJob: vi.fn(),
  }
})

type RouteHandlers = {
  GET: (ctx: { request: Request }) => Promise<Response>
  PATCH: (ctx: { request: Request }) => Promise<Response>
}

const handlers = (
  Route as unknown as {
    options: { server: { handlers: RouteHandlers } }
  }
).options.server.handlers

beforeEach(() => {
  state.authenticated = false
  vi.clearAllMocks()
})

describe('swarm dispatch queue API authorization and retry', () => {
  it('requires authentication before reading queue state', async () => {
    const response = await handlers.GET({
      request: new Request('http://localhost/api/swarm-dispatch'),
    })

    expect(response.status).toBe(401)
    expect(queue.snapshot).not.toHaveBeenCalled()
  })

  it('requires authentication before accepting a retry action', async () => {
    const response = await handlers.PATCH({
      request: new Request(
        'http://localhost/api/swarm-dispatch?id=00000000-0000-4000-8000-000000000000',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ acknowledgePossibleDuplicate: true }),
        },
      ),
    })

    expect(response.status).toBe(401)
    expect(queue.retry).not.toHaveBeenCalled()
  })

  it('requires explicit duplicate-risk acknowledgement for a dead-letter retry', async () => {
    state.authenticated = true
    vi.mocked(retrySwarmDispatchQueueJob).mockRejectedValueOnce(
      new SwarmDispatchQueueRetryError(
        'acknowledgement-required',
        'Explicit acknowledgement is required.',
      ),
    )
    const response = await handlers.PATCH({
      request: new Request(
        'http://localhost/api/swarm-dispatch?id=00000000-0000-4000-8000-000000000000',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            acknowledgePossibleDuplicate: false,
            approvalNote: 'Retry reviewed by operator.',
          }),
        },
      ),
    })

    expect(retrySwarmDispatchQueueJob).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000000',
      false,
      { operator: 'authenticated-operator', note: 'Retry reviewed by operator.' },
    )
    expect(response.status).toBe(409)
  })

  it('accepts an explicitly acknowledged retry and reports its queue result', async () => {
    state.authenticated = true
    vi.mocked(retrySwarmDispatchQueueJob).mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000001',
      position: 1,
      queuedAt: 1,
      retryOfJobId: '00000000-0000-4000-8000-000000000000',
      alreadyQueued: false,
      auditId: '00000000-0000-4000-8000-000000000002',
    })
    const response = await handlers.PATCH({
      request: new Request(
        'http://localhost/api/swarm-dispatch?id=00000000-0000-4000-8000-000000000000',
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            acknowledgePossibleDuplicate: true,
            approvalNote: 'Retry reviewed by operator.',
          }),
        },
      ),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      retryOfJobId: '00000000-0000-4000-8000-000000000000',
      alreadyQueued: false,
      auditId: '00000000-0000-4000-8000-000000000002',
    })
  })

  it('pauses and resumes a queued job without requiring retry approval', async () => {
    state.authenticated = true
    vi.mocked(queue.pause).mockResolvedValueOnce({ found: true, status: 'paused' })
    const id = '00000000-0000-4000-8000-000000000000'
    const paused = await handlers.PATCH({
      request: new Request(`http://localhost/api/swarm-dispatch?id=${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      }),
    })
    expect(paused.status).toBe(200)
    expect(queue.pause).toHaveBeenCalledWith(id)
    expect(queue.retry).not.toHaveBeenCalled()

    vi.mocked(queue.resume).mockResolvedValueOnce({ found: true, status: 'pending' })
    const resumed = await handlers.PATCH({
      request: new Request(`http://localhost/api/swarm-dispatch?id=${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      }),
    })
    expect(resumed.status).toBe(200)
    expect(queue.resume).toHaveBeenCalledWith(id)
  })
})
