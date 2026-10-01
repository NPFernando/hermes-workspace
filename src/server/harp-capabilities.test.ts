import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forgetLearnedCapability } from './harp-capabilities'

describe('forgetLearnedCapability', () => {
  let dir: string
  const env = { ...process.env }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harp-cap-'))
    delete process.env.HARP_API_TOKEN
    process.env.HARP_API_TOKEN_FILE = path.join(dir, 'api-token')
    process.env.HARP_API_URL = 'http://harp.test'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...env }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects invalid input before calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fs.writeFileSync(process.env.HARP_API_TOKEN_FILE!, 'tok')
    expect(await forgetLearnedCapability({ model: '' })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(
      await forgetLearnedCapability({ model: 'a b; rm -rf' }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await forgetLearnedCapability({ model: 'gpt-6-sol', option: 'BAD!' }),
    ).toMatchObject({ ok: false, error: 'Invalid option' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('needs a token', async () => {
    const result = await forgetLearnedCapability({ model: 'gpt-6-sol' })
    expect(result).toMatchObject({ ok: false, status: 503 })
  })

  it('posts model + option with the bearer token from the token file', async () => {
    fs.writeFileSync(process.env.HARP_API_TOKEN_FILE!, 'secret-token\n')
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ model: 'claude-haiku-4-5', forgotten: ['effort'] }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await forgetLearnedCapability({
      model: 'claude-haiku-4-5',
      option: 'effort',
    })
    expect(result).toEqual({
      ok: true,
      model: 'claude-haiku-4-5',
      forgotten: ['effort'],
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('http://harp.test/v1/capability/forget')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer secret-token',
    )
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'claude-haiku-4-5',
      option: 'effort',
    })
  })

  it('maps API errors and outages to 502', async () => {
    process.env.HARP_API_TOKEN = 'tok'
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
          }),
      ),
    )
    expect(await forgetLearnedCapability({ model: 'gpt-6-sol' })).toEqual({
      ok: false,
      status: 502,
      error: 'HARP API: unauthorized',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    const down = await forgetLearnedCapability({ model: 'gpt-6-sol' })
    expect(down).toMatchObject({ ok: false, status: 502 })
  })
})
