import { afterEach, describe, expect, it, vi } from 'vitest'
import { difyConfig, getDifyIntegration, getDifyStatus, runDifyWorkflow, validateDifyPublicInputs } from './dify'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

describe('Dify public workflow adapter', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  function configure() {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_API_ENABLED', 'true')
    vi.stubEnv('DIFY_API_BASE_URL', 'http://127.0.0.1:5200')
    vi.stubEnv('DIFY_API_KEY', 'server-only-key')
    vi.stubEnv('DIFY_WORKFLOWS_JSON', JSON.stringify([{ id: 'public-faq', name: 'Public FAQ', provider: 'Dify Cloud' }]))
  }

  it('rejects sensitive fields before making an outbound request', () => {
    expect(() => validateDifyPublicInputs({ birthDate: '2000-01-01' })).toThrow(/not allowed/)
    expect(() => validateDifyPublicInputs({ prompt: 'My home address is 12 Example Road.' })).toThrow(/private data/)
  })

  it('runs only an allowlisted workflow and stores metadata without inputs', async () => {
    configure()
    const directory = await mkdtemp(join(tmpdir(), 'dify-adapter-'))
    const historyFile = join(directory, 'history.json')
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: { id: 'run-123', outputs: { answer: 'public result' } } }), { status: 200 })))
    const result = await runDifyWorkflow('public-faq', { prompt: 'Summarize a public release note.' }, fetchImpl, historyFile)
    expect(result.execution.status).toBe('succeeded')
    expect(result.execution.runId).toBe('run-123')
    expect(result.outputs).toEqual({ answer: 'public result' })
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:5200/workflows/run', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer server-only-key' }),
    }))
    const history = await readFile(historyFile, 'utf8')
    expect(history).toContain('public-faq')
    expect(history).not.toContain('Summarize a public release note.')
    expect(getDifyIntegration()).toMatchObject({ enabled: true, configured: true, workflows: [{ id: 'public-faq' }] })
  })
})
