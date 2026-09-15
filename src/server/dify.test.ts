import { afterEach, describe, expect, it, vi } from 'vitest'
import { difyConfig, getDifyStatus } from './dify'

describe('Dify workbench status', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('is disabled by default and does not probe a provider', async () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', '0')
    vi.stubEnv('DIFY_WORKBENCH_URL', '')
    vi.stubEnv('DIFY_BASE_URL', '')
    const fetchImpl = vi.fn()
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({ enabled: false, available: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires an explicit browser URL when enabled', async () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', '')
    vi.stubEnv('DIFY_BASE_URL', '')
    const fetchImpl = vi.fn()
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({ enabled: true, configured: false, available: false, url: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks the provider root while returning only the browser URL', async () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', 'https://dify.example.test/')
    vi.stubEnv('DIFY_HEALTHCHECK_URL', 'http://127.0.0.1:5200')
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })))
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({ enabled: true, configured: true, available: true, url: 'https://dify.example.test' })
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:5200/', expect.objectContaining({ headers: { accept: 'text/html,application/json' } }))
  })

  it.each(['https://user:password@dify.example.test', 'https://dify.example.test/?api_key=secret', 'javascript:alert(1)'])('rejects unsafe workbench URLs (%s)', async (url) => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', url)
    const fetchImpl = vi.fn()
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({ enabled: true, configured: false, available: false, url: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('difyConfig', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('keeps a separate internal health-check URL from the browser URL', () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', 'https://dify.example.test')
    vi.stubEnv('DIFY_HEALTHCHECK_URL', 'http://127.0.0.1:5200')
    expect(difyConfig()).toEqual({ enabled: true, url: 'https://dify.example.test', healthUrl: 'http://127.0.0.1:5200' })
  })
})
