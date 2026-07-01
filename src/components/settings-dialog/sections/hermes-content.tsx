import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import BackendUnavailableState from '@/components/backend-unavailable-state'
import { getUnavailableReason } from '@/lib/feature-gates'
import { useFeatureAvailable } from '@/hooks/use-feature-available'
import { ProviderLogo } from '@/components/provider-logo'

// ── Section components ──────────────────────────────────────────────────

const PROVIDER_CARDS: Array<{
  id: string
  name: string
  logo: string
  models: Array<string>
  authType: 'oauth' | 'api_key' | 'none'
  envKey?: string
}> = [
  // Local providers first — zero setup
  {
    id: 'ollama',
    name: 'Ollama',
    logo: '/providers/ollama.png',
    models: ['llama3.1:70b', 'qwen3:32b', 'deepseek-r1:32b'],
    authType: 'none',
  },
  {
    id: 'atomic-chat',
    name: 'Atomic Chat',
    logo: '/providers/atomic-chat.png',
    models: ['llama-3.2-3b', 'qwen2.5-7b', 'gemma-3-4b'],
    authType: 'none',
  },
  // Cloud providers
  {
    id: 'anthropic',
    name: 'Anthropic',
    logo: '/providers/anthropic.png',
    models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-3-5'],
    authType: 'api_key',
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'nous',
    name: 'Nous Portal',
    logo: '/providers/nous.png',
    models: [
      'xiaomi/mimo-v2-pro',
      'xiaomi/mimo-v2-omni',
      'claude-3-llama-3.1-405b',
      'claude-3-llama-3.1-70b',
    ],
    authType: 'oauth',
  },
  {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    logo: '/providers/openai.png',
    models: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-4o'],
    authType: 'oauth',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    logo: '/providers/openrouter.png',
    models: ['auto', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro'],
    authType: 'api_key',
    envKey: 'OPENROUTER_API_KEY',
  },
  {
    id: 'zai',
    name: 'Z.AI / GLM',
    logo: '/providers/zhipu.png',
    models: ['glm-4-plus', 'glm-4-air'],
    authType: 'api_key',
    envKey: 'GLM_API_KEY',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi',
    logo: '/providers/kimi.png',
    models: ['kimi-latest', 'moonshot-v1-128k'],
    authType: 'api_key',
    envKey: 'KIMI_API_KEY',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    logo: '/providers/minimax.png',
    models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-Lightning'],
    authType: 'api_key',
    envKey: 'MINIMAX_API_KEY',
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    logo: '/providers/xiaomi.png',
    models: ['mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'],
    authType: 'api_key',
    envKey: 'XIAOMI_API_KEY',
  },
  { id: 'custom', name: 'Custom', logo: '', models: [], authType: 'api_key', envKey: 'CUSTOM_API_KEY' },
]

export type ProviderClickAction = 'select' | 'oauth' | 'local' | 'custom' | 'ignore'

export function getProviderClickAction(input: {
  providerId?: string
  authType: 'oauth' | 'api_key' | 'none'
  hasKey: boolean
}): ProviderClickAction {
  if (input.providerId === 'custom') return 'custom'
  if (input.authType === 'oauth') return 'oauth'
  if (input.authType === 'none') return 'local'
  return input.hasKey ? 'select' : 'ignore'
}

const LOCAL_PROVIDER_SETUP: Partial<Record<
  string,
  { baseUrl: string; unavailableMessage: string }
>> = {
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    unavailableMessage:
      'No Ollama endpoint detected at http://127.0.0.1:11434/v1.',
  },
  'atomic-chat': {
    baseUrl: 'http://127.0.0.1:1337/v1',
    unavailableMessage:
      'No Atomic Chat endpoint detected at http://127.0.0.1:1337/v1.',
  },
}

export type OAuthStatus = 'idle' | 'starting' | 'pending' | 'success' | 'error'

const DEFAULT_OAUTH_EXPIRES_SECONDS = 600
const DEFAULT_OAUTH_POLL_INTERVAL_SECONDS = 3

export function getOAuthStartButtonLabel(status: OAuthStatus): string {
  return status === 'starting' || status === 'pending'
    ? 'Waiting...'
    : 'Start OAuth'
}

type OAuthDeviceCodeResponse = {
  device_code?: string
  user_code?: string
  verification_uri_complete?: string
  interval?: number
  expires_in?: number
  error?: string
}

type OAuthPollResponse = {
  status?: string
  message?: string
}

export function HermesContent() {
  const configAvailable = useFeatureAvailable('config')
  const [activeProvider, setActiveProvider] = useState('')
  const [activeModel, setActiveModel] = useState('')
  const [defaultProvider, setDefaultProvider] = useState('')
  const [defaultModelId, setDefaultModelId] = useState('')
  const [availableModels, setAvailableModels] = useState<Array<string>>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [_saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, string>>(
    {},
  )
  const [memEnabled, setMemEnabled] = useState(true)
  const [userProfileEnabled, setUserProfileEnabled] = useState(true)
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [oauthProviderId, setOauthProviderId] = useState<string | null>(null)
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>('idle')
  const [oauthMessage, setOauthMessage] = useState('')
  const [oauthUserCode, setOauthUserCode] = useState('')
  const [oauthVerificationUri, setOauthVerificationUri] = useState('')
  const oauthAbortRef = useRef<AbortController | null>(null)
  const [localProviderId, setLocalProviderId] = useState<string | null>(null)
  const [localDiscovery, setLocalDiscovery] = useState<{
    providers: Array<{
      id: string
      name: string
      online: boolean
      modelCount: number
      configured: boolean
      needsRestart: boolean
    }>
    models: Array<{ id: string; name: string; provider: string }>
  } | null>(null)

  const fetchModelsForProvider = useCallback(
    (providerId: string) => {
      // For local providers, prefer auto-discovered models first
      if (localDiscovery) {
        const discovered = localDiscovery.models
          .filter((m) => m.provider === providerId)
          .map((m) => m.id)
        if (discovered.length > 0) {
          setAvailableModels(discovered)
          return
        }
      }
      fetch(
        `/api/claude-proxy/api/available-models?provider=${encodeURIComponent(providerId)}`,
      )
        .then((r) => r.json())
        .then((d: { models?: Array<{ id: string }> }) => {
          setAvailableModels((d.models || []).map((m) => m.id))
        })
        .catch(() => {
          // Fall back to hardcoded
          const card = PROVIDER_CARDS.find((p) => p.id === providerId)
          setAvailableModels(card?.models || [])
        })
    },
    [localDiscovery],
  )

  useEffect(() => {
    fetch('/api/local-providers')
      .then((r) => r.json())
      .then((d: any) => {
        if (d.ok) setLocalDiscovery(d)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/hermes-config')
      .then((r) => r.json())
      .then((d: any) => {
        setActiveProvider(d.activeProvider || '')
        setActiveModel(d.activeModel || '')
        setDefaultProvider(d.activeProvider || '')
        setDefaultModelId(d.activeModel || '')
        if (d.activeProvider) fetchModelsForProvider(d.activeProvider)
        const mem = d.config?.memory
          ? (d.config.memory as Record<string, unknown>)
          : {}
        setMemEnabled(mem.memory_enabled !== false)
        setUserProfileEnabled(mem.user_profile_enabled !== false)
        // Build configured keys map
        const keys: Record<string, string> = {}
        for (const p of d.providers || []) {
          const envKey = p.envKeys?.[0]
          if (!p.configured || !envKey) continue
          keys[envKey] = p.maskedCredentials?.[envKey] || '••••'
        }
        setConfiguredKeys(keys)
        // Load custom provider config (may be stored as 'custom' or legacy 'manifest')
        const cfgProviders = d.config?.providers
          ? (d.config.providers as Record<string, any>)
          : {}
        const customCfg = cfgProviders['custom'] || cfgProviders['manifest'] || {}
        if (customCfg.base_url) setCustomBaseUrl(customCfg.base_url)
        if (d.activeProvider === 'custom' && d.activeModel) {
          setCustomModel(d.activeModel)
        }
      })
      .catch(() => {})
  }, [])

  const refreshConfig = async () => {
    const ref = await fetch('/api/hermes-config')
    const d = await ref.json()
    setDefaultProvider(d.activeProvider || '')
    setDefaultModelId(d.activeModel || '')
    if (
      (d.activeProvider === 'custom' || d.activeProvider === 'manifest') &&
      d.activeModel
    ) {
      setCustomModel(d.activeModel)
    }
    const keys: Record<string, string> = {}
    for (const p of d.providers || []) {
      const envKey = p.envKeys?.[0]
      if (!p.configured || !envKey) continue
      keys[envKey] = p.maskedCredentials?.[envKey] || '••••'
    }
    setConfiguredKeys(keys)
  }

  const save = async (
    updates:
      | { config?: Record<string, unknown>; env?: Record<string, string> }
      | { action: string; [key: string]: unknown },
  ) => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/hermes-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const r = (await res.json()) as { message?: string }
      setMsg(r.message || 'Saved')
      await refreshConfig()
      setTimeout(() => setMsg(null), 3000)
    } catch {
      setMsg('Failed to save')
    }
    setSaving(false)
  }

  const setDefaultModel = (providerId: string, modelId: string) => {
    return save({ action: 'set-default-model', providerId, modelId })
  }

  const selectProvider = (providerId: string, model?: string) => {
    setOauthProviderId(null)
    setLocalProviderId(null)
    if (providerId !== activeProvider) setActiveModel('')
    setActiveProvider(providerId)
    if (model) setActiveModel(model)
    else fetchModelsForProvider(providerId)
  }

  const clearProviderPreview = () => {
    setActiveProvider('')
    setActiveModel('')
    setAvailableModels([])
  }

  const abortOAuth = () => {
    oauthAbortRef.current?.abort()
    oauthAbortRef.current = null
  }

  const resetOAuthState = (providerId: string) => {
    abortOAuth()
    setOauthProviderId(providerId)
    setLocalProviderId(null)
    clearProviderPreview()
    setOauthStatus('idle')
    setOauthMessage('')
    setOauthUserCode('')
    setOauthVerificationUri('')
    setMsg(null)
  }

  const showLocalProviderSetup = (providerId: string) => {
    abortOAuth()
    setOauthProviderId(null)
    setLocalProviderId(providerId)
    clearProviderPreview()
    setMsg(null)
  }

  const showCustomProviderSetup = () => {
    abortOAuth()
    setOauthProviderId(null)
    setLocalProviderId(null)
    setActiveProvider('custom')
    setAvailableModels([])
    setMsg(null)
  }

  useEffect(() => {
    return () => abortOAuth()
  }, [])

  const sleepUnlessAborted = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })

  const startOAuthFlow = async () => {
    const provider = PROVIDER_CARDS.find((p) => p.id === oauthProviderId)
    if (!provider) return

    abortOAuth()
    const controller = new AbortController()
    oauthAbortRef.current = controller
    const { signal } = controller

    setOauthStatus('starting')
    setOauthMessage(`Starting ${provider.name} OAuth...`)
    setOauthUserCode('')
    setOauthVerificationUri('')

    try {
      const codeRes = await fetch('/api/oauth/device-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.id }),
        signal,
      })
      const codeData = (await codeRes.json()) as OAuthDeviceCodeResponse
      if (!codeRes.ok || codeData.error || !codeData.device_code) {
        throw new Error(codeData.error || 'Could not start OAuth device flow')
      }

      const verificationUri = codeData.verification_uri_complete || ''
      setOauthStatus('pending')
      setOauthUserCode(codeData.user_code || '')
      setOauthVerificationUri(verificationUri)
      setOauthMessage(
        verificationUri
          ? `Authorize ${provider.name} in the browser, then return here.`
          : `Enter the user code to authorize ${provider.name}.`,
      )

      if (verificationUri) {
        window.open(verificationUri, '_blank', 'noopener,noreferrer')
      }

      const expiresInSeconds = codeData.expires_in || DEFAULT_OAUTH_EXPIRES_SECONDS
      const intervalSeconds = Math.max(
        1,
        codeData.interval || DEFAULT_OAUTH_POLL_INTERVAL_SECONDS,
      )
      const deadline = Date.now() + expiresInSeconds * 1000
      const intervalMs = intervalSeconds * 1000

      while (Date.now() < deadline) {
        await sleepUnlessAborted(intervalMs, signal)
        const pollRes = await fetch('/api/oauth/poll-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: provider.id,
            deviceCode: codeData.device_code,
          }),
          signal,
        })
        const pollData = (await pollRes.json()) as OAuthPollResponse
        if (pollData.status === 'pending') continue
        if (pollData.status === 'success') {
          setOauthStatus('success')
          setOauthMessage(
            `${provider.name} OAuth is connected. TUI and WebUI will use the shared Hermes credentials.`,
          )
          await refreshConfig()
          return
        }
        throw new Error(pollData.message || 'OAuth authorization failed')
      }

      throw new Error('OAuth authorization timed out')
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return
      setOauthStatus('error')
      setOauthMessage(
        error instanceof Error ? error.message : 'OAuth authorization failed',
      )
    } finally {
      if (oauthAbortRef.current === controller) {
        oauthAbortRef.current = null
      }
    }
  }

  if (!configAvailable) {
    return (
      <BackendUnavailableState
        feature="Hermes Agent Settings"
        description={getUnavailableReason('config')}
      />
    )
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--theme-card)',
    border: '1px solid var(--theme-border)',
    color: 'var(--theme-text)',
  }
  const mutedStyle: React.CSSProperties = { color: 'var(--theme-muted)' }

  return (
    <div className="space-y-5">
      {msg && (
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-medium',
            msg.includes('Failed')
              ? 'bg-red-500/15 text-red-400'
              : 'bg-green-500/15 text-green-400',
          )}
        >
          {msg}
        </div>
      )}

      {/* Provider Selection */}
      <div>
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-wider"
          style={mutedStyle}
        >
          Provider
        </p>
        <p className="mb-3 text-[11px]" style={mutedStyle}>
          Select your AI provider. OAuth providers authenticate via browser.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PROVIDER_CARDS.map((p) => {
            const isActive =
              (oauthProviderId || localProviderId || activeProvider) === p.id
            const localOnline =
              localDiscovery?.providers.find((lp) => lp.id === p.id)?.online ===
              true
            // verified = truly available right now. OAuth status isn't tracked
            // here, so OAuth providers stay neutral until an actual session
            // check is wired. Local providers require live discovery hit.
            const verified =
              (p.authType === 'none' && localOnline) ||
              (p.authType === 'api_key' &&
                !!p.envKey &&
                !!configuredKeys[p.envKey])
            const missingKey =
              p.authType === 'api_key' && !verified && p.id !== 'custom'
            // hasKey gates click — keep OAuth + local clickable (existing
            // behaviour) so users can still authenticate via the card.
            const hasKey =
              p.authType === 'none' ||
              p.authType === 'oauth' ||
              verified ||
              p.id === 'custom'
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const action = getProviderClickAction({
                    providerId: p.id,
                    authType: p.authType,
                    hasKey,
                  })
                  if (action === 'oauth') {
                    resetOAuthState(p.id)
                    return
                  }
                  if (action === 'local') {
                    showLocalProviderSetup(p.id)
                    return
                  }
                  if (action === 'custom') {
                    showCustomProviderSetup()
                    return
                  }
                  if (action === 'select') selectProvider(p.id)
                }}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl px-3 py-2.5 text-left transition-all',
                  isActive
                    ? 'ring-2 ring-accent-500 shadow-md'
                    : 'hover:brightness-110',
                  missingKey && 'opacity-60',
                )}
                style={cardStyle}
              >
                <div className="flex w-full items-center justify-between">
                  <ProviderLogo provider={p.id} size={32} />
                  {/* Single-dot precedence: active > missing-key > verified > none */}
                  {isActive ? (
                    <span className="size-2 rounded-full bg-green-500" />
                  ) : missingKey ? (
                    <span className="size-2 rounded-full bg-red-500/60" />
                  ) : verified ? (
                    <span className="size-2 rounded-full bg-green-500/40" />
                  ) : null}
                </div>
                <span className="text-xs font-semibold mt-1">{p.name}</span>
                <span className="text-[9px]" style={mutedStyle}>
                  {(() => {
                    const disc = localDiscovery?.providers.find(
                      (lp) => lp.id === p.id,
                    )
                    if (disc?.online) return '🟢 Detected'
                    if (p.authType === 'oauth') return 'OAuth'
                    if (p.authType === 'none') return 'Local'
                    return hasKey ? 'Key set' : 'Key required'
                  })()}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {oauthProviderId ? (
        <div className="rounded-xl px-3 py-2.5" style={cardStyle}>
          {(() => {
            const provider = PROVIDER_CARDS.find((p) => p.id === oauthProviderId)
            if (!provider) return null

            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{provider.name} OAuth</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={oauthStatus === 'starting' || oauthStatus === 'pending'}
                    onClick={() => {
                      void startOAuthFlow()
                    }}
                  >
                    {getOAuthStartButtonLabel(oauthStatus)}
                  </Button>
                </div>

                <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-xs text-[var(--theme-muted)]">
                  {oauthMessage || 'Start the browser-based OAuth flow.'}
                  {oauthUserCode ? (
                    <div className="mt-2">
                      User code:{' '}
                      <code className="rounded bg-black/10 px-1 py-0.5 font-mono dark:bg-white/10">
                        {oauthUserCode}
                      </code>
                    </div>
                  ) : null}
                  {oauthVerificationUri ? (
                    <a
                      href={oauthVerificationUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block font-medium underline underline-offset-2"
                    >
                      Open authorization page
                    </a>
                  ) : null}
                </div>
              </div>
            )
          })()}
        </div>
      ) : null}

      {localProviderId ? (
        <div className="rounded-xl px-3 py-2.5" style={cardStyle}>
          {(() => {
            const provider = PROVIDER_CARDS.find((p) => p.id === localProviderId)
            if (!provider) return null
            const disc = localDiscovery?.providers.find(
              (lp) => lp.id === provider.id,
            )
            const models =
              localDiscovery?.models.filter((m) => m.provider === provider.id) ||
              []
            const setup = LOCAL_PROVIDER_SETUP[provider.id] || {
              baseUrl: 'local OpenAI-compatible endpoint',
              unavailableMessage: 'No local endpoint detected.',
            }

            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{provider.name}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-xs text-[var(--theme-muted)]">
                  {disc?.online ? (
                    <>
                      Detected {disc.modelCount} model
                      {disc.modelCount === 1 ? '' : 's'} at{' '}
                      <code className="rounded bg-black/10 px-1 py-0.5 font-mono dark:bg-white/10">
                        {setup.baseUrl}
                      </code>
                      .
                    </>
                  ) : (
                    setup.unavailableMessage
                  )}
                  {disc?.needsRestart ? (
                    <div className="mt-2 text-yellow-700 dark:text-yellow-200">
                      Gateway restart may be needed after adding this provider to
                      config.
                    </div>
                  ) : null}
                </div>

                {models.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={mutedStyle}>
                      Detected Models
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {models.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          aria-pressed={
                            activeProvider === provider.id &&
                            activeModel === model.id
                          }
                          onClick={() => {
                            setActiveProvider(provider.id)
                            setActiveModel(model.id)
                          }}
                          className={cn(
                            'rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:brightness-110',
                            activeProvider === provider.id &&
                              activeModel === model.id
                              ? 'ring-2 ring-accent-500'
                              : '',
                          )}
                          style={cardStyle}
                        >
                          {model.id}
                          {defaultProvider === provider.id &&
                          defaultModelId === model.id
                            ? ' · default'
                            : ''}
                        </button>
                      ))}
                    </div>
                    {activeProvider === provider.id &&
                    activeModel &&
                    (defaultProvider !== provider.id ||
                      activeModel !== defaultModelId) ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => setDefaultModel(provider.id, activeModel)}
                        >
                          Set as default: {provider.id} · {activeModel}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })()}
        </div>
      ) : null}

      {/* Model Selection for active provider */}
      {!oauthProviderId && !localProviderId && activeProvider && activeProvider !== 'custom' && (
        <div>
          <p
            className="mb-1 text-xs font-semibold uppercase tracking-wider"
            style={mutedStyle}
          >
            Model — pick one, then confirm below
          </p>
          <div className="flex flex-wrap gap-2">
            {(() => {
              if (availableModels.length > 0) return availableModels
              // Use auto-discovered models for local providers
              const discovered = localDiscovery?.models
                .filter((m) => m.provider === activeProvider)
                .map((m) => m.id)
              if (discovered && discovered.length > 0) return discovered
              return (
                PROVIDER_CARDS.find((p) => p.id === activeProvider)?.models ||
                []
              )
            })().map((model) => (
              <button
                key={model}
                type="button"
                aria-pressed={activeModel === model}
                onClick={() => setActiveModel(model)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  activeModel === model
                    ? 'ring-2 ring-accent-500'
                    : 'hover:brightness-110',
                  defaultProvider === activeProvider && defaultModelId === model
                    ? 'border border-accent-500/40'
                    : '',
                )}
                style={cardStyle}
              >
                {model}
                {defaultProvider === activeProvider && defaultModelId === model
                  ? ' · default'
                  : ''}
              </button>
            ))}
          </div>
          {activeModel &&
          (activeProvider !== defaultProvider || activeModel !== defaultModelId) ? (
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setDefaultModel(activeProvider, activeModel)}
              >
                Set as default: {activeProvider} · {activeModel}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {/* Custom OpenAI-compatible endpoint fields — Base URL only; API key lives in API Keys section */}
      {activeProvider === 'custom' && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={mutedStyle}>
            Custom Endpoint
          </p>
          <div className="space-y-1.5">
            {(() => {
              const isEditing = editingKey === 'custom_base_url'
              const hasValue = !!customBaseUrl
              return (
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={cardStyle}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">Base URL</div>
                    <div className="text-[11px] font-mono" style={mutedStyle}>
                      {isEditing ? (
                        <input
                          type="url"
                          value={customBaseUrl}
                          onChange={(e) => setCustomBaseUrl(e.target.value)}
                          placeholder="http://127.0.0.1:38238/v1"
                          className="w-full rounded border-0 bg-transparent py-0.5 text-[11px] outline-none text-[var(--theme-text)]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              save({ config: { model: { provider: 'manifest' }, providers: { manifest: { type: 'openai', base_url: customBaseUrl, key_env: 'CUSTOM_API_KEY' } } } })
                                .then(() => setEditingKey(null))
                            }
                            if (e.key === 'Escape') setEditingKey(null)
                          }}
                        />
                      ) : hasValue ? customBaseUrl : 'Not configured'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('size-2 rounded-full', hasValue ? 'bg-emerald-400' : 'bg-[var(--theme-muted)]')} />
                    {isEditing ? (
                      <>
                        <button type="button" onClick={() => { save({ config: { model: { provider: 'manifest' }, providers: { manifest: { type: 'openai', base_url: customBaseUrl, key_env: 'CUSTOM_API_KEY' } } } }).then(() => setEditingKey(null)) }} className="text-xs font-medium text-green-400">Save</button>
                        <button type="button" onClick={() => setEditingKey(null)} className="text-xs" style={mutedStyle}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setEditingKey('custom_base_url')} className="text-xs font-medium text-[var(--theme-accent)]">
                        {hasValue ? 'Edit' : 'Add'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}
            {(() => {
              const isEditing = editingKey === 'custom_model'
              const hasValue = !!customModel
              return (
                <div
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={cardStyle}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">Model</div>
                    <div
                      className="text-[11px] font-mono"
                      style={mutedStyle}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          placeholder="e.g. gpt-4o-mini, llama3:8b"
                          className="w-full rounded border-0 bg-transparent py-0.5 text-[11px] outline-none text-[var(--theme-text)]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setEditingKey(null)
                            if (e.key === 'Escape') setEditingKey(null)
                          }}
                        />
                      ) : hasValue ? (
                        customModel
                      ) : (
                        'Not configured'
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        hasValue ? 'bg-emerald-400' : 'bg-[var(--theme-muted)]',
                      )}
                    />
                    {isEditing ? (
                      <button
                        type="button"
                        onClick={() => setEditingKey(null)}
                        className="text-xs font-medium text-green-400"
                      >
                        Done
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingKey('custom_model')}
                        className="text-xs font-medium text-[var(--theme-accent)]"
                      >
                        {hasValue ? 'Edit' : 'Add'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
          {customBaseUrl &&
          customModel &&
          (defaultProvider !== 'custom' || customModel !== defaultModelId) ? (
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setDefaultModel('custom', customModel)}
              >
                Set as default: custom · {customModel}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {(() => {
        const disc = localDiscovery?.providers.find(
          (lp) => lp.id === activeProvider,
        )
        if (!disc || !disc.needsRestart) return null
        return (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
            ⚠️ Gateway restart needed to use {disc.name}. Run{' '}
            <code className="rounded bg-black/30 px-1">
              hermes gateway restart
            </code>{' '}
            in your terminal.
          </div>
        )
      })()}

      {/* API Keys */}
      <div>
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-wider"
          style={mutedStyle}
        >
          API Keys
        </p>
        <div className="space-y-1.5">
          {PROVIDER_CARDS.filter((p) => p.envKey).map((p) => {
            const key = p.envKey!
            const hasKey = !!configuredKeys[key]
            const isEditing = editingKey === key
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={cardStyle}
              >
                <ProviderLogo
                  provider={p.id}
                  size={28}
                  className="rounded-md"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-[11px] font-mono" style={mutedStyle}>
                    {isEditing ? (
                      <input
                        type="password"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder={`Paste ${key}`}
                        className="w-full rounded border-0 bg-transparent py-0.5 text-[11px] outline-none text-[var(--theme-text)]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && keyInput) {
                            save({ env: { [key]: keyInput } })
                            setEditingKey(null)
                            setKeyInput('')
                          }
                          if (e.key === 'Escape') {
                            setEditingKey(null)
                            setKeyInput('')
                          }
                        }}
                      />
                    ) : hasKey ? (
                      configuredKeys[key]
                    ) : (
                      'Not configured'
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      hasKey ? 'bg-emerald-400' : 'bg-[var(--theme-muted)]',
                    )}
                  />
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (keyInput) {
                            save({ env: { [key]: keyInput } })
                          }
                          setEditingKey(null)
                          setKeyInput('')
                        }}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium bg-accent-500 text-white"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingKey(null)
                          setKeyInput('')
                        }}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--theme-muted)]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(key)
                        setKeyInput('')
                      }}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent-500/10"
                      style={{
                        color: 'var(--theme-accent, var(--theme-text))',
                      }}
                    >
                      {hasKey ? 'Update' : 'Add'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Memory */}
      <div>
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-wider"
          style={mutedStyle}
        >
          Memory
        </p>
        <div className="space-y-1.5">
          <div
            className="flex items-center justify-between rounded-xl px-3 py-2.5"
            style={cardStyle}
          >
            <div>
              <div className="text-sm font-medium">Memory</div>
              <div className="text-[11px]" style={mutedStyle}>
                Store & recall memories across sessions
              </div>
            </div>
            <Switch
              checked={memEnabled}
              onCheckedChange={(c) => {
                setMemEnabled(c)
                save({ config: { memory: { memory_enabled: c } } })
              }}
            />
          </div>
          <div
            className="flex items-center justify-between rounded-xl px-3 py-2.5"
            style={cardStyle}
          >
            <div>
              <div className="text-sm font-medium">User Profile</div>
              <div className="text-[11px]" style={mutedStyle}>
                Remember preferences & context
              </div>
            </div>
            <Switch
              checked={userProfileEnabled}
              onCheckedChange={(c) => {
                setUserProfileEnabled(c)
                save({ config: { memory: { user_profile_enabled: c } } })
              }}
            />
          </div>
        </div>
      </div>

      {/* Runtime Info */}
      <div className="rounded-xl px-3 py-2.5" style={cardStyle}>
        <div className="flex items-center gap-2 mb-2">
          <span className="size-2 rounded-full bg-green-500 animate-pulse" />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={mutedStyle}
          >
            Runtime
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <span style={mutedStyle}>Model</span>
          <span className="font-mono font-medium">{activeModel || '—'}</span>
          <span style={mutedStyle}>Provider</span>
          <span className="font-mono font-medium">
            {PROVIDER_CARDS.find((p) => p.id === activeProvider)?.name ||
              activeProvider ||
              '—'}
          </span>
          <span style={mutedStyle}>Config</span>
          <span className="font-mono font-medium">~/.hermes/config.yaml</span>
        </div>
      </div>
    </div>
  )
}
