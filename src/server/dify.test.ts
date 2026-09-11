import { afterEach, describe, expect, it, vi } from 'vitest'
import { difyConfig, getDifyStatus } from './dify'

describe('Dify workbench status', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('is disabled by default and does not probe a provider', async () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', '0')
    const fetchImpl = vi.fn()
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({ enabled: false, available: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports reachable enabled providers without exposing credentials', async () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', 'https://dify.example.test/')
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })))
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({ enabled: true, configured: true, available: true, url: 'https://dify.example.test' })
    expect(fetchImpl).toHaveBeenCalledWith('https://dify.example.test/health', expect.objectContaining({ headers: { accept: 'application/json' } }))
  })
})
