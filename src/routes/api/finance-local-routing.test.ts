import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openaiChat: vi.fn(),
  ensureDiscovery: vi.fn(),
  getDiscoveredModels: vi.fn(),
  getLocalProviderDef: vi.fn(),
}))

vi.mock('./openai-compat-api', () => ({ openaiChat: mocks.openaiChat }))
vi.mock('./local-provider-discovery', () => ({
  ensureDiscovery: mocks.ensureDiscovery,
  getDiscoveredModels: mocks.getDiscoveredModels,
  getLocalProviderDef: mocks.getLocalProviderDef,
}))

describe('finance local-only routing', () => {
  beforeEach(() => {
    process.env.FINANCE_AI_LOCAL_ONLY = '1'
    mocks.ensureDiscovery.mockResolvedValue(undefined)
    mocks.getDiscoveredModels.mockReturnValue([
      { id: 'llama3.2:latest', provider: 'ollama' },
    ])
    mocks.getLocalProviderDef.mockReturnValue({
      id: 'ollama',
      name: 'Ollama',
      port: 11434,
      modelsPath: '/v1/models',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'ollama',
      apiMode: 'chat_completions',
    })
    mocks.openaiChat.mockReset()
  })

  afterEach(() => {
    delete process.env.FINANCE_AI_LOCAL_ONLY
    vi.restoreAllMocks()
  })

  it('uses the local provider and never reaches an external fallback', async () => {
    const externalFetch = vi.fn()
    vi.stubGlobal('fetch', externalFetch)
    mocks.openaiChat.mockResolvedValue(
      '{"kind":"expense","amount":100,"currency":"LKR","vendorOrSource":"Local Test","date":"2026-09-11","confidence":"high"}',
    )

    const { extractTransactionFromText } = await import('./finance-extraction')
    const result = await extractTransactionFromText('private transaction text')

    expect(result).toMatchObject({ ok: true })
    expect(mocks.openaiChat).toHaveBeenCalledOnce()
    expect(mocks.openaiChat.mock.calls[0]?.[1]).toMatchObject({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2:latest',
      omitAuth: true,
    })
    expect(externalFetch).not.toHaveBeenCalled()
  })

  it('fails closed when no local model is discovered', async () => {
    mocks.getDiscoveredModels.mockReturnValue([])
    const { extractTransactionFromText } = await import('./finance-extraction')

    await expect(
      extractTransactionFromText('private transaction text'),
    ).resolves.toEqual({
      ok: false,
      reason: 'local_provider_unavailable',
    })
    expect(mocks.openaiChat).not.toHaveBeenCalled()
  })

  it('sends document images to the local provider without an external fallback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'finance-local-routing-'))
    const imagePath = join(dir, 'receipt.jpg')
    const externalFetch = vi.fn()
    vi.stubGlobal('fetch', externalFetch)
    mocks.openaiChat.mockResolvedValue(
      '{"kind":"expense","amount":100,"currency":"LKR","vendorOrSource":"Local Image Test","date":"2026-09-11","confidence":"high"}',
    )
    await writeFile(imagePath, Buffer.from('test image bytes'))

    try {
      const { extractTransactionFromImage } =
        await import('./finance-extraction')
      const result = await extractTransactionFromImage(imagePath)

      expect(result).toMatchObject({ ok: true })
      expect(mocks.openaiChat).toHaveBeenCalledOnce()
      expect(JSON.stringify(mocks.openaiChat.mock.calls[0]?.[0])).toContain(
        'data:image/jpeg;base64,dGVzdCBpbWFnZSBieXRlcw==',
      )
      expect(mocks.openaiChat.mock.calls[0]?.[1]).toMatchObject({
        omitAuth: true,
      })
      expect(externalFetch).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
