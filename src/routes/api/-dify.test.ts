import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
  getSessionTokenFromCookie: vi.fn(() => null),
}))

vi.mock('../../server/dify-client', () => ({
  runDifyApp: vi.fn(),
  stopDifyRun: vi.fn(),
  uploadDifyFile: vi.fn(),
  resumeDifyWorkflow: vi.fn(),
}))

import {
  getSessionTokenFromCookie,
  isAuthenticated,
} from '../../server/auth-middleware'
import { runDifyApp, stopDifyRun } from '../../server/dify-client'
import { Route as FilesRoute } from './dify/apps.$appId.files'
import { Route as RunRoute } from './dify/apps.$appId.run'
import { Route as StopRoute } from './dify/apps.$appId.stop'
import { Route as EventsRoute } from './dify/runs.$appId.$runId.events'
import { getDifyUserId } from '../../server/dify-route'

type Handler = (context: {
  request: Request
  params: { appId: string }
}) => Promise<Response>

const runHandler = (RunRoute as any).server.handlers.POST as Handler
const stopHandler = (StopRoute as any).server.handlers.POST as Handler
const filesHandler = (FilesRoute as any).server.handlers.POST as Handler
const eventsHandler = (EventsRoute as any).server.handlers.GET as Handler

afterEach(() => {
  vi.resetAllMocks()
})

describe('Dify execution routes', () => {
  it('rejects unauthenticated execution before reaching Dify', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const response = await runHandler({
      request: new Request('http://localhost/api/dify/apps/research/run', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      }),
      params: { appId: 'research' },
    })

    expect(response.status).toBe(401)
    expect(runDifyApp).not.toHaveBeenCalled()
  })

  it('returns 400 for non-object execution payloads', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)

    const response = await runHandler({
      request: new Request('http://localhost/api/dify/apps/research/run', {
        method: 'POST',
        body: 'null',
        headers: { 'Content-Type': 'application/json' },
      }),
      params: { appId: 'research' },
    })

    expect(response.status).toBe(400)
    expect(runDifyApp).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Request body must be a JSON object',
    })
  })

  it('forwards only the supported execution fields and preserves streaming output', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(runDifyApp).mockResolvedValue(
      new Response('data: {"event":"workflow_started"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )

    const response = await runHandler({
      request: new Request('http://localhost/api/dify/apps/research/run', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'workflow',
          inputs: { topic: 'astrology' },
          query: 'Research this topic',
          response_mode: 'streaming',
          ignored: 'not forwarded',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      params: { appId: 'research' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await expect(response.text()).resolves.toContain('workflow_started')
    expect(runDifyApp).toHaveBeenCalledWith('research', {
      mode: 'workflow',
      inputs: { topic: 'astrology' },
      response_mode: 'streaming',
      user: 'hermes-workspace',
      query: 'Research this topic',
    })
  })

  it('derives different opaque Dify identities from different session cookies', () => {
    vi.mocked(getSessionTokenFromCookie)
      .mockReturnValueOnce('session-one')
      .mockReturnValueOnce('session-two')

    const first = getDifyUserId(
      new Request('http://localhost/api/dify', {
        headers: { cookie: 'claude-auth=session-one' },
      }),
    )
    const second = getDifyUserId(
      new Request('http://localhost/api/dify', {
        headers: { cookie: 'claude-auth=session-two' },
      }),
    )

    expect(first).not.toBe(second)
    expect(first).not.toContain('session-one')
    expect(second).not.toContain('session-two')
    expect(first).toMatch(/^hermes-[a-f0-9]{32}$/)
  })

  it('rejects malformed stop requests before reaching Dify', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)

    const response = await stopHandler({
      request: new Request('http://localhost/api/dify/apps/research/stop', {
        method: 'POST',
        body: '[]',
        headers: { 'Content-Type': 'application/json' },
      }),
      params: { appId: 'research' },
    })

    expect(response.status).toBe(400)
    expect(stopDifyRun).not.toHaveBeenCalled()
  })

  it('rejects oversized multipart requests before parsing the body', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)

    const response = await filesHandler({
      request: new Request('http://localhost/api/dify/apps/research/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=test',
          'Content-Length': String(10 * 1024 * 1024 + 256 * 1024 + 1),
        },
      }),
      params: { appId: 'research' },
    })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Upload request is too large',
    })
  })

  it('rejects unauthenticated workflow reconnects before reaching Dify', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const response = await eventsHandler({
      request: new Request(
        'http://localhost/api/dify/runs/research/run-1/events',
      ),
      params: { appId: 'research' },
    })

    expect(response.status).toBe(401)
  })
})
