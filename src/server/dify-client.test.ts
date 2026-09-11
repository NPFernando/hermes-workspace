import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DifyClientError,
  getDifyAppInfo,
  probeDify,
  runDifyApp,
  stopDifyRun,
} from './dify-client'

const originalEnv = { ...process.env }

function configureDify() {
  process.env.DIFY_ENABLED = 'true'
  process.env.DIFY_BASE_URL = 'http://dify.test/'
  process.env.DIFY_APPS_JSON = JSON.stringify([
    {
      id: 'research-app',
      label: 'Research',
      keyEnv: 'DIFY_RESEARCH_KEY',
    },
  ])
  process.env.DIFY_RESEARCH_KEY = 'secret-key'
}

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('Dify client', () => {
  it('stays disabled unless explicitly enabled and configured', async () => {
    delete process.env.DIFY_ENABLED
    delete process.env.DIFY_BASE_URL
    expect(await probeDify()).toEqual({
      configured: false,
      reachable: false,
      apps: 0,
    })
  })

  it('probes the configured service without sending an app key', async () => {
    configureDify()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))

    await expect(probeDify()).resolves.toEqual({
      configured: true,
      reachable: true,
      apps: 1,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dify.test/console/api/setup',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({
      headers: expect.anything(),
    })
  })

  it('uses the registered app key only on server-side app requests', async () => {
    configureDify()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ name: 'Research', mode: 'workflow' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(getDifyAppInfo('research-app')).resolves.toMatchObject({
      name: 'Research',
      mode: 'workflow',
    })
    const requestOptions = fetchMock.mock.calls[0]?.[1]
    expect(requestOptions?.headers).toBeInstanceOf(Headers)
    expect((requestOptions?.headers as Headers).get('authorization')).toBe(
      'Bearer secret-key',
    )
  })

  it('rejects app IDs that are not in the explicit registry', async () => {
    configureDify()
    await expect(getDifyAppInfo('unknown-app')).rejects.toMatchObject({
      status: 404,
      code: 'unknown_app',
    } satisfies Partial<DifyClientError>)
  })

  it('preserves streaming responses for workflow execution', async () => {
    configureDify()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"event":"finished"}\n\n'),
        )
        controller.close()
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )

    const response = await runDifyApp('research-app', {
      mode: 'workflow',
      inputs: { topic: 'Hermes' },
      response_mode: 'streaming',
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://dify.test/v1/workflows/run')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      inputs: { topic: 'Hermes' },
      response_mode: 'streaming',
    })
  })

  it('maps the Workbench query into Dify completion inputs', async () => {
    configureDify()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"answer":"ok"}', { status: 200 }))

    await runDifyApp('research-app', {
      mode: 'completion',
      inputs: {},
      query: 'Hermes',
      response_mode: 'blocking',
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      inputs: { query: 'Hermes' },
      query: 'Hermes',
      response_mode: 'blocking',
    })
  })

  it('stops workflow tasks through the correct Dify endpoint', async () => {
    configureDify()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"result":"success"}', { status: 200 }))

    await expect(
      stopDifyRun('research-app', 'task-1', 'workflow'),
    ).resolves.toEqual({
      result: 'success',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://dify.test/v1/workflows/tasks/task-1/stop',
    )
  })
})
