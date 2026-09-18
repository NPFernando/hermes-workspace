import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compareDifyWorkflowVersions,
  difyConfig,
  getDifyIntegration,
  getDifyStatus,
  rollbackDifyWorkflow,
  runDifyWorkflow,
  validateDifyPublicInputs,
} from './dify'

describe('Dify workbench status', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is disabled by default and does not probe a provider', async () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', '0')
    vi.stubEnv('DIFY_WORKBENCH_URL', '')
    vi.stubEnv('DIFY_BASE_URL', '')
    const fetchImpl = vi.fn()
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({
      enabled: false,
      available: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires an explicit browser URL when enabled', async () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', '')
    vi.stubEnv('DIFY_BASE_URL', '')
    const fetchImpl = vi.fn()
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({
      enabled: true,
      configured: false,
      available: false,
      url: null,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks the provider root while returning only the browser URL', async () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', 'https://dify.example.test/')
    vi.stubEnv('DIFY_HEALTHCHECK_URL', 'http://127.0.0.1:5200')
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('ok', { status: 200 })),
    )
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({
      enabled: true,
      configured: true,
      available: true,
      url: 'https://dify.example.test',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:5200/',
      expect.objectContaining({
        headers: { accept: 'text/html,application/json' },
      }),
    )
  })

  it.each([
    'https://user:password@dify.example.test',
    'https://dify.example.test/?api_key=secret',
    'javascript:alert(1)',
  ])('rejects unsafe workbench URLs (%s)', async (url) => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', url)
    const fetchImpl = vi.fn()
    await expect(getDifyStatus(fetchImpl)).resolves.toMatchObject({
      enabled: true,
      configured: false,
      available: false,
      url: null,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('difyConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps a separate internal health-check URL from the browser URL', () => {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_WORKBENCH_URL', 'https://dify.example.test')
    vi.stubEnv('DIFY_HEALTHCHECK_URL', 'http://127.0.0.1:5200')
    expect(difyConfig()).toEqual({
      enabled: true,
      url: 'https://dify.example.test',
      healthUrl: 'http://127.0.0.1:5200',
    })
  })
})

describe('Dify public workflow adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function configure() {
    vi.stubEnv('DIFY_WORKBENCH_ENABLED', 'true')
    vi.stubEnv('DIFY_API_ENABLED', 'true')
    vi.stubEnv('DIFY_API_BASE_URL', 'http://127.0.0.1:5200')
    vi.stubEnv('DIFY_API_KEY', 'server-only-key')
    vi.stubEnv(
      'DIFY_WORKFLOWS_JSON',
      JSON.stringify([
        { id: 'public-faq', name: 'Public FAQ', provider: 'Dify Cloud' },
      ]),
    )
  }

  function configureVersions() {
    vi.stubEnv(
      'DIFY_WORKFLOW_VERSIONS_JSON',
      JSON.stringify([
        {
          workflowId: 'public-faq',
          version: '2026-09-15',
          name: 'Public FAQ stable',
          description: 'Stable public FAQ workflow',
          provider: 'Dify Cloud',
        },
        {
          workflowId: 'public-faq',
          version: '2026-09-16',
          name: 'Public FAQ revised',
          description: 'Revised public FAQ workflow',
          provider: 'Dify Cloud',
        },
      ]),
    )
  }

  it('rejects sensitive fields before making an outbound request', () => {
    expect(() => validateDifyPublicInputs({ birthDate: '2000-01-01' })).toThrow(
      /not allowed/,
    )
    expect(() =>
      validateDifyPublicInputs({
        prompt: 'My home address is 12 Example Road.',
      }),
    ).toThrow(/private data/)
  })

  it('runs only an allowlisted workflow and stores metadata without inputs', async () => {
    configure()
    const directory = await mkdtemp(join(tmpdir(), 'dify-adapter-'))
    const historyFile = join(directory, 'history.json')
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { id: 'run-123', outputs: { answer: 'public result' } },
          }),
          { status: 200 },
        ),
      ),
    )
    const result = await runDifyWorkflow(
      'public-faq',
      { prompt: 'Summarize a public release note.' },
      fetchImpl,
      historyFile,
    )
    expect(result.execution.status).toBe('succeeded')
    expect(result.execution.runId).toBe('run-123')
    expect(result.outputs).toEqual({ answer: 'public result' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:5200/workflows/run',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer server-only-key',
        }),
      }),
    )
    const history = await readFile(historyFile, 'utf8')
    expect(history).toContain('public-faq')
    expect(history).not.toContain('Summarize a public release note.')
    expect(getDifyIntegration()).toMatchObject({
      enabled: true,
      configured: true,
      workflows: [{ id: 'public-faq' }],
    })
  })

  it('retries transient provider failures and records the configured workflow version', async () => {
    configure()
    vi.stubEnv(
      'DIFY_WORKFLOWS_JSON',
      JSON.stringify([
        {
          id: 'public-faq',
          name: 'Public FAQ',
          provider: 'Dify Cloud',
          version: '2026-09-16',
        },
      ]),
    )
    const directory = await mkdtemp(join(tmpdir(), 'dify-retry-'))
    const historyFile = join(directory, 'history.json')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: 'run-retried', outputs: { answer: 'ok' } },
          }),
          { status: 200 },
        ),
      )
    const result = await runDifyWorkflow(
      'public-faq',
      { prompt: 'Summarize a public release note.' },
      fetchImpl,
      historyFile,
      { maxRetries: 1, timeoutMs: 5_000 },
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.execution.workflowVersion).toBe('2026-09-16')
    expect(result.execution.runId).toBe('run-retried')
  })

  it('records operator cancellation distinctly from provider failure', async () => {
    configure()
    const directory = await mkdtemp(join(tmpdir(), 'dify-cancel-'))
    const historyFile = join(directory, 'history.json')
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason ?? new Error('cancelled')),
            { once: true },
          )
        }),
    )
    const run = runDifyWorkflow(
      'public-faq',
      { prompt: 'Summarize a public release note.' },
      fetchImpl,
      historyFile,
      { signal: controller.signal, timeoutMs: 5_000 },
    )
    controller.abort('operator-cancelled')
    await expect(run).rejects.toBe('operator-cancelled')
    const history = JSON.parse(await readFile(historyFile, 'utf8')) as Array<{
      status: string
      error: string | null
    }>
    expect(history[0]).toMatchObject({
      status: 'cancelled',
      error: 'Dify workflow cancelled.',
    })
  })

  it('compares configured workflow versions without exposing credentials', () => {
    configure()
    configureVersions()
    const comparison = compareDifyWorkflowVersions(
      'public-faq',
      '2026-09-15',
      '2026-09-16',
    )
    expect(comparison.changes).toEqual([
      {
        field: 'name',
        before: 'Public FAQ stable',
        after: 'Public FAQ revised',
      },
      {
        field: 'description',
        before: 'Stable public FAQ workflow',
        after: 'Revised public FAQ workflow',
      },
    ])
    expect(getDifyIntegration()).toMatchObject({
      versions: [
        { workflowId: 'public-faq', version: '2026-09-15' },
        { workflowId: 'public-faq', version: '2026-09-16' },
      ],
    })
    expect(JSON.stringify(getDifyIntegration())).not.toContain('server-only-key')
  })

  it('rolls back the active workflow mapping only when explicitly enabled', async () => {
    configure()
    configureVersions()
    vi.stubEnv('DIFY_WORKFLOW_ROLLBACK_ENABLED', 'true')
    const directory = await mkdtemp(join(tmpdir(), 'dify-version-state-'))
    vi.stubEnv('HERMES_WORKSPACE_STATE_DIR', directory)
    const integration = rollbackDifyWorkflow(
      'public-faq',
      '2026-09-15',
      'Restore stable public FAQ after review.',
    )
    expect(integration.activeVersions).toEqual({
      'public-faq': '2026-09-15',
    })
    expect(integration.rollbackHistory[0]).toMatchObject({
      workflowId: 'public-faq',
      version: '2026-09-15',
      requestedBy: 'authenticated-operator',
    })
  })
})
