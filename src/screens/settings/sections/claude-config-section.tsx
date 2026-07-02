import {
  CloudIcon,
  Delete02Icon,
  Mic01Icon,
  Notification03Icon,
  PaintBoardIcon,
  Settings02Icon,
  SourceCodeSquareIcon,
  SparklesIcon,
  UserIcon,
  VolumeHighIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useEffect, useState } from 'react'
import { SettingsRow, SettingsSection } from './settings-primitives'
import { CHANGELOG } from '@/lib/changelog'
import { GROQ_STT_MODELS, STT_PROVIDER_OPTIONS } from '@/lib/stt-config'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'

type ClaudeProvider = {
  id: string
  name: string
  authType: string
  envKeys: Array<string>
  configured: boolean
  maskedKeys: Record<string, string>
}

type ClaudeConfigData = {
  config: Record<string, unknown>
  providers: Array<ClaudeProvider>
  activeProvider: string
  activeModel: string
  claudeHome: string
}

const CLAUDE_API =
  process.env.HERMES_API_URL ||
  process.env.CLAUDE_API_URL ||
  'http://127.0.0.1:8642'

type AvailableModelsResponse = {
  provider: string
  models: Array<{ id: string; description: string }>
  providers: Array<{ id: string; label: string; authenticated: boolean }>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Best-effort URL for an OpenAI-compatible stack: manifest/custom block,
 * custom_providers row matching the active provider (case-insensitive), then
 * top-level base_url (used by named providers like ECLIPSE + remote Ollama).
 */
function resolveCustomBaseUrlFromConfig(
  config: Record<string, unknown>,
  activeProvider: string,
): string {
  const providersConfig = config.providers as Record<string, unknown> | undefined
  const customBlock = (providersConfig?.manifest || providersConfig?.custom) as
    | Record<string, unknown>
    | undefined
  let url = typeof customBlock?.base_url === 'string' ? customBlock.base_url.trim() : ''
  if (!url && Array.isArray(config.custom_providers)) {
    const aid = activeProvider.trim().toLowerCase()
    for (const e of config.custom_providers) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) continue
      const rec = e as Record<string, unknown>
      const name = String(rec.name ?? '').trim().toLowerCase()
      if (name && name === aid && typeof rec.base_url === 'string') {
        url = rec.base_url.trim()
        break
      }
    }
  }
  if (!url && typeof config.base_url === 'string') {
    const top = config.base_url.trim()
    if (top) url = top
  }
  return url
}

function readFallbackInputsFromConfig(config: Record<string, unknown>): {
  provider: string
  model: string
  baseUrl: string
} {
  const fb = config.fallback_model
  if (!fb || typeof fb !== 'object' || Array.isArray(fb)) {
    return { provider: '', model: '', baseUrl: '' }
  }
  const o = fb as Record<string, unknown>
  return {
    provider: typeof o.provider === 'string' ? o.provider : '',
    model: typeof o.model === 'string' ? o.model : '',
    baseUrl: typeof o.base_url === 'string' ? o.base_url : '',
  }
}

function normalizeCustomProviderEntry(
  entry: Record<string, unknown>,
): {
  name: string
  title: string
  base_url: string
  api_key?: string
  api_mode?: string
} {
  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  const title = typeof entry.title === 'string' ? entry.title.trim() : ''
  const base_url = typeof entry.base_url === 'string' ? entry.base_url.trim() : ''
  const api_key = typeof entry.api_key === 'string' ? entry.api_key : undefined
  const api_mode = typeof entry.api_mode === 'string' ? entry.api_mode : undefined
  return { name, title, base_url, api_key, api_mode }
}

function urlNormForDedupe(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

/** True if this name or base URL already appears in custom_providers. */
function entryCoveredByCustomProviderList(
  name: string,
  baseUrl: string,
  list: Array<Record<string, unknown>>,
): boolean {
  const n = name.trim().toLowerCase()
  const u = baseUrl.trim() ? urlNormForDedupe(baseUrl) : ''
  for (const raw of list) {
    const e = normalizeCustomProviderEntry(raw)
    const en = e.name.toLowerCase()
    const eu = e.base_url ? urlNormForDedupe(e.base_url) : ''
    if (n && en && n === en) return true
    if (u && eu && u === eu) return true
  }
  return false
}

function readManifestBlockBaseUrl(config: Record<string, unknown>): string {
  const providersConfig = config.providers as Record<string, unknown> | undefined
  const customBlock = (providersConfig?.manifest || providersConfig?.custom) as
    | Record<string, unknown>
    | undefined
  return typeof customBlock?.base_url === 'string' ? customBlock.base_url.trim() : ''
}

function deriveCustomProviderNameFromBaseUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/[^a-zA-Z0-9-]+/g, '-')
    return host ? `ep-${host}` : 'custom-endpoint'
  } catch {
    return 'custom-endpoint'
  }
}

/** e.g. Qwen3.6.Eclipse from model filename + URL hostname first label */
function suggestCustomProviderTitle(model: string, baseUrl: string): string {
  let modelPart = (model || '').trim()
  const lastSeg = modelPart.includes('/') ? modelPart.split('/').pop() || modelPart : modelPart
  modelPart = (lastSeg || 'model').replace(/\.gguf$/i, '')
  const dashIdx = modelPart.indexOf('-')
  if (dashIdx > 0) modelPart = modelPart.slice(0, dashIdx)
  modelPart = modelPart.replace(/[^a-zA-Z0-9.]/g, '') || 'Model'
  let hostPart = 'Host'
  try {
    const h = new URL(baseUrl.trim()).hostname
    hostPart = h.split('.')[0] || h
  } catch {
    /* keep Host */
  }
  const capHost = hostPart
    ? hostPart.charAt(0).toUpperCase() + hostPart.slice(1).toLowerCase()
    : 'Host'
  return `${modelPart}.${capHost}`
}

function slugifyCustomProviderId(title: string, baseUrl: string): string {
  const t = title.trim()
  if (t) {
    let s = t
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (s.length > 56) s = s.slice(0, 56)
    if (s) return s
  }
  return deriveCustomProviderNameFromBaseUrl(baseUrl || 'http://127.0.0.1')
}

function mergeModelForManifestSave(
  config: Record<string, unknown>,
  modelInputTrimmed: string,
): Record<string, unknown> {
  const existing = config.model
  if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    const o = { ...(existing as Record<string, unknown>) }
    o.provider = 'manifest'
    if (typeof o.default !== 'string' || !o.default.trim()) {
      if (modelInputTrimmed) o.default = modelInputTrimmed
    }
    return o
  }
  if (typeof existing === 'string' && existing.trim()) {
    return { default: existing.trim(), provider: 'manifest' }
  }
  if (modelInputTrimmed) {
    return { default: modelInputTrimmed, provider: 'manifest' }
  }
  return { provider: 'manifest' }
}

export function ClaudeConfigSection({
  activeView = 'claude',
}: {
  activeView?: 'claude' | 'agent' | 'routing' | 'voice' | 'display'
}) {
  const [data, setData] = useState<ClaudeConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [modelInput, setModelInput] = useState('')
  const [providerInput, setProviderInput] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [editingCustomKey, setEditingCustomKey] = useState(false)
  const [editingCustomBaseUrl, setEditingCustomBaseUrl] = useState(false)
  const [addCpTitle, setAddCpTitle] = useState('')
  const [addCpProviderId, setAddCpProviderId] = useState('')
  const [addCpBaseUrl, setAddCpBaseUrl] = useState('')
  const [addCpYamlKey, setAddCpYamlKey] = useState('')
  const [fallbackProviderInput, setFallbackProviderInput] = useState('')
  const [fallbackModelInput, setFallbackModelInput] = useState('')
  const [fallbackBaseUrlInput, setFallbackBaseUrlInput] = useState('')
  const [showFallbackRow, setShowFallbackRow] = useState(false)

  const [availableProviders, setAvailableProviders] = useState<
    Array<{ id: string; label: string; authenticated: boolean }>
  >([])
  const [availableModels, setAvailableModels] = useState<
    Array<{ id: string; description: string }>
  >([])
  const [loadingModels, setLoadingModels] = useState(false)

  const syncInputsFromData = useCallback((configData: ClaudeConfigData) => {
    const cfg = configData.config
    setModelInput(configData.activeModel || '')
    setProviderInput(configData.activeProvider || '')
    setBaseUrlInput((cfg.base_url as string) || '')
    const fb = readFallbackInputsFromConfig(cfg)
    setFallbackProviderInput(fb.provider)
    setFallbackModelInput(fb.model)
    setFallbackBaseUrlInput(fb.baseUrl)
    setShowFallbackRow(Boolean(fb.provider || fb.model || fb.baseUrl))

    setCustomBaseUrl(readManifestBlockBaseUrl(cfg))
  }, [])

  const fetchConfig = useCallback(async () => {
    const res = await fetch('/api/claude-config')
    const configData = (await res.json()) as ClaudeConfigData
    setData(configData)
    syncInputsFromData(configData)
    return configData
  }, [syncInputsFromData])

  const fetchModelsForProvider = useCallback(async (provider: string) => {
    if (!provider) {
      setAvailableModels([])
      return
    }
    setLoadingModels(true)
    try {
      const res = await fetch(
        `/api/claude-proxy/api/available-models?provider=${encodeURIComponent(provider)}`,
      )
      if (res.ok) {
        const result = (await res.json()) as AvailableModelsResponse
        setAvailableModels(result.models)
        if (result.providers.length > 0) setAvailableProviders(result.providers)
      }
    } catch {
      // ignore
    }
    setLoadingModels(false)
  }, [])

  useEffect(() => {
    fetchConfig()
      .then((configData) => {
        setLoading(false)
        if (configData.activeProvider) {
          void fetchModelsForProvider(configData.activeProvider)
        }
      })
      .catch(() => setLoading(false))
  }, [fetchConfig, fetchModelsForProvider])

  const saveConfig = async (updates: {
    config?: Record<string, unknown>
    env?: Record<string, string | null>
  }) => {
    setSaving(true)
    setSaveMessage(null)
    try {
      const res = await fetch('/api/claude-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const result = (await res.json()) as { message?: string }
      setSaveMessage(result.message || 'Saved')
      const refreshData = await fetchConfig()
      if (refreshData.activeProvider) {
        void fetchModelsForProvider(refreshData.activeProvider)
      }
      setTimeout(() => setSaveMessage(null), 3000)
    } catch {
      setSaveMessage('Failed to save')
    }
    setSaving(false)
  }

  const selectClassName =
    'h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-sm text-[var(--theme-text)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] md:max-w-sm'

  const readNumber = (value: unknown, fallback: number) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  const readBoolean = (value: unknown, fallback: boolean) => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return value === 'true'
    return fallback
  }

  const saveNumberField = (
    section: string,
    field: string,
    rawValue: string,
    fallback: number,
  ) => {
    const value = rawValue === '' ? fallback : Number(rawValue)
    if (!Number.isFinite(value)) return
    void saveConfig({ config: { [section]: { [field]: value } } })
  }

  if (loading) {
    return (
      <SettingsSection
        title="Hermes Agent"
        description="Loading configuration..."
        icon={Settings02Icon}
      >
        <div
          className="h-20 animate-pulse rounded-lg bg-[var(--theme-panel)]"
        />
      </SettingsSection>
    )
  }

  if (!data) {
    return (
      <SettingsSection
        title="Hermes Agent"
        description="Could not load Hermes configuration."
        icon={Settings02Icon}
      >
        <p className="text-sm text-[var(--theme-muted)]">
          Make sure Hermes Agent is running on localhost:8642
        </p>
      </SettingsSection>
    )
  }

  const memoryConfig = asRecord(data.config.memory)
  const terminalConfig = asRecord(data.config.terminal)
  const displayConfig = asRecord(data.config.display)
  const agentConfig = asRecord(data.config.agent)
  const smartRouting = asRecord(data.config.smart_model_routing)
  const ttsConfig = asRecord(data.config.tts)
  const sttConfig = asRecord(data.config.stt)
  const customProviders = Array.isArray(data.config.custom_providers)
    ? (data.config.custom_providers as Array<Record<string, unknown>>)
    : []

  const resolvedCustomBaseUrl = resolveCustomBaseUrlFromConfig(
    data.config,
    data.activeProvider,
  )
  const customProviderCatalogEntry = data.providers.find((p) => p.id === 'custom')
  const customApiKeyConfigured = Boolean(customProviderCatalogEntry?.configured)
  const customEndpointConfigured =
    customApiKeyConfigured || Boolean(resolvedCustomBaseUrl)

  const manifestBlockOnlyUrl = readManifestBlockBaseUrl(data.config)
  const primaryConfigBaseUrl =
    typeof data.config.base_url === 'string' ? data.config.base_url.trim() : ''
  const primaryConfigProvider = (data.activeProvider || '').trim()

  const extraPrimaryNotInList =
    primaryConfigProvider &&
    primaryConfigBaseUrl &&
    !entryCoveredByCustomProviderList(
      primaryConfigProvider,
      primaryConfigBaseUrl,
      customProviders,
    )
      ? { name: primaryConfigProvider, base_url: primaryConfigBaseUrl }
      : null

  const extraManifestNotInList =
    manifestBlockOnlyUrl &&
    !entryCoveredByCustomProviderList('', manifestBlockOnlyUrl, customProviders) &&
    urlNormForDedupe(manifestBlockOnlyUrl) !==
      urlNormForDedupe(primaryConfigBaseUrl || '') &&
    !(
      extraPrimaryNotInList &&
      urlNormForDedupe(manifestBlockOnlyUrl) ===
        urlNormForDedupe(extraPrimaryNotInList.base_url)
    )
      ? { base_url: manifestBlockOnlyUrl }
      : null

  function persistCustomProviderRow(
    name: string,
    base_url: string,
    opts?: { title?: string; yamlApiKey?: string },
  ) {
    const n = name.trim()
    const u = base_url.trim()
    if (!n || !u) {
      setSaveMessage('Provider id and base URL are both required to save a row.')
      setTimeout(() => setSaveMessage(null), 4000)
      return
    }
    const others = customProviders.filter((e) => String(e.name ?? '').trim() !== n)
    const prev = customProviders.find((e) => String(e.name ?? '').trim() === n)
    const api_mode =
      prev && typeof prev.api_mode === 'string' && prev.api_mode
        ? prev.api_mode
        : 'chat_completions'

    let rowApi: string | undefined
    if (opts && 'yamlApiKey' in opts) {
      const trimmed = opts.yamlApiKey?.trim() ?? ''
      rowApi = trimmed || undefined
    } else if (prev && typeof prev.api_key === 'string' && prev.api_key) {
      rowApi = prev.api_key
    } else if (n === 'ollama' || n === 'atomic-chat') {
      rowApi = n
    }

    const row: Record<string, unknown> = { name: n, base_url: u, api_mode }
    if (opts?.title?.trim()) row.title = opts.title.trim()
    else if (prev && typeof prev.title === 'string' && prev.title.trim()) {
      row.title = prev.title.trim()
    }
    if (rowApi) row.api_key = rowApi

    void saveConfig({
      config: {
        custom_providers: [row, ...others],
      },
    })
  }

  function submitAddCustomProviderForm() {
    const title = addCpTitle.trim()
    const url = addCpBaseUrl.trim()
    if (!title) {
      setSaveMessage('Add a title so you can recognize this endpoint (e.g. Qwen3.6.Eclipse).')
      setTimeout(() => setSaveMessage(null), 4000)
      return
    }
    if (!url) {
      setSaveMessage('Base URL is required.')
      setTimeout(() => setSaveMessage(null), 4000)
      return
    }
    const id = addCpProviderId.trim() || slugifyCustomProviderId(title, url)
    persistCustomProviderRow(id, url, {
      title,
      yamlApiKey: addCpYamlKey,
    })
    setAddCpTitle('')
    setAddCpProviderId('')
    setAddCpBaseUrl('')
    setAddCpYamlKey('')
  }

  function saveCurrentToCustomProvidersList() {
    if (!providerInput.trim() || !baseUrlInput.trim()) {
      setSaveMessage('Enter both provider and base URL in Model & Provider, then try again.')
      setTimeout(() => setSaveMessage(null), 4000)
      return
    }
    const bu = baseUrlInput.trim()
    persistCustomProviderRow(providerInput.trim(), bu, {
      title: suggestCustomProviderTitle(modelInput, bu),
    })
  }

  function applyCustomProviderFromList(entry: Record<string, unknown>) {
    const n = normalizeCustomProviderEntry(entry)
    if (!n.name) return
    setProviderInput(n.name)
    setBaseUrlInput(n.base_url)
    void fetchModelsForProvider(n.name)
  }

  function removeCustomProviderAt(index: number) {
    const next = customProviders.filter((_, i) => i !== index)
    void saveConfig({ config: { custom_providers: next } })
  }

  const ttsProvider = (ttsConfig.provider as string) || 'edge'
  const ttsEdge = asRecord(ttsConfig.edge)
  const ttsElevenLabs = asRecord(ttsConfig.elevenlabs)
  const ttsOpenAi = asRecord(ttsConfig.openai)
  const sttProvider = (sttConfig.provider as string) || 'local'
  const sttLocal = asRecord(sttConfig.local)
  const sttGroq = asRecord(sttConfig.groq)

  const manifestBaseUrlOnly = readManifestBlockBaseUrl(data.config)

  const renderClaudeOverview = () => (
    <>
      <SettingsSection
        title="Model & Provider"
        description="Configure the default AI model for Hermes Agent."
        icon={SourceCodeSquareIcon}
      >
        <SettingsRow
          label="Provider"
          description="Select the inference provider."
        >
          <div className="flex w-full max-w-sm gap-2">
            {availableProviders.length > 0 ? (
              <select
                value={providerInput}
                onChange={(e) => {
                  const newProvider = e.target.value
                  setProviderInput(newProvider)
                  setModelInput('')
                  void fetchModelsForProvider(newProvider)
                }}
                className={selectClassName}
              >
                {availableProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.authenticated ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={providerInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setProviderInput(e.target.value)
                }
                placeholder="e.g. ollama, anthropic, openai-codex"
                className="flex-1"
              />
            )}
          </div>
        </SettingsRow>
        <SettingsRow
          label="Model"
          description="The model Claude uses for conversations."
        >
          <div className="flex w-full max-w-sm gap-2">
            {availableModels.length > 0 ? (
              <select
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                className={`${selectClassName} font-mono`}
              >
                {!availableModels.some((m) => m.id === modelInput) &&
                  modelInput && (
                    <option value={modelInput}>{modelInput} (current)</option>
                  )}
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                    {m.description ? ` — ${m.description}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={modelInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setModelInput(e.target.value)
                }
                placeholder={
                  loadingModels ? 'Loading models...' : 'e.g. qwen3.5:35b'
                }
                className="flex-1 font-mono"
              />
            )}
          </div>
        </SettingsRow>
        <SettingsRow
          label="Base URL"
          description="For local providers (Ollama, LM Studio, MLX). Leave blank for cloud."
        >
          <div className="flex w-full max-w-sm gap-2">
            <Input
              value={baseUrlInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setBaseUrlInput(e.target.value)
              }
              placeholder="e.g. http://localhost:11434/v1"
              className="flex-1 font-mono text-sm"
            />
          </div>
        </SettingsRow>

        <div className="rounded-xl border border-[var(--theme-border)] bg-white/80 px-3 py-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-[var(--theme-text)]">
                Fallback model (optional)
              </p>
              <p className="text-xs text-[var(--theme-muted)]">
                Used only if the primary model fails. Keep empty to disable — avoids mixing this
                up with your main provider (for example OpenRouter only here, local primary above).
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => setShowFallbackRow((v) => !v)}
            >
              {showFallbackRow ? 'Hide fallback fields' : 'Show fallback fields'}
            </Button>
          </div>
          {showFallbackRow ? (
            <div className="mt-3 space-y-3 border-t border-[var(--theme-border)] pt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[var(--theme-muted)]">Fallback provider</span>
                  <Input
                    value={fallbackProviderInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setFallbackProviderInput(e.target.value)
                    }
                    placeholder="e.g. openrouter"
                    className="font-mono text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[var(--theme-muted)]">Fallback model id</span>
                  <Input
                    value={fallbackModelInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setFallbackModelInput(e.target.value)
                    }
                    placeholder="provider/model or model id"
                    className="font-mono text-sm"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--theme-muted)]">Fallback base URL</span>
                <Input
                  value={fallbackBaseUrlInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFallbackBaseUrlInput(e.target.value)
                  }
                  placeholder="Leave blank for hosted APIs"
                  className="font-mono text-sm"
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            disabled={saving}
            onClick={() => {
              const hasFallback =
                fallbackProviderInput.trim() ||
                fallbackModelInput.trim() ||
                fallbackBaseUrlInput.trim()
              const configUpdate: Record<string, unknown> = {
                model: modelInput.trim(),
                provider: providerInput.trim(),
                base_url: baseUrlInput.trim() || null,
              }
              if (hasFallback) {
                configUpdate.fallback_model = {
                  provider: fallbackProviderInput.trim(),
                  model: fallbackModelInput.trim(),
                  base_url: fallbackBaseUrlInput.trim() || null,
                }
              } else {
                configUpdate.fallback_model = null
              }
              void saveConfig({ config: configUpdate })
            }}
          >
            {saving ? 'Saving...' : 'Save Model'}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="API Keys"
        description="Manage provider API keys stored in ~/.hermes/.env"
        icon={CloudIcon}
      >
        {data.providers
          .filter((p) => p.envKeys.length > 0 && p.id !== 'custom')
          .map((provider) => (
            <SettingsRow
              key={provider.id}
              label={provider.name}
              description={
                provider.configured ? '✅ Configured' : '— Not configured'
              }
            >
              <div className="flex w-full max-w-sm items-center gap-2">
                {provider.envKeys.map((envKey) => (
                  <div key={envKey} className="flex-1">
                    {editingKey === envKey ? (
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          value={keyInput}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setKeyInput(e.target.value)
                          }
                          placeholder={`Enter ${envKey}`}
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            void saveConfig({ env: { [envKey]: keyInput } })
                            setEditingKey(null)
                            setKeyInput('')
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingKey(null)
                            setKeyInput('')
                          }}
                        >
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-mono text-[var(--theme-muted)]"
                        >
                          {provider.maskedKeys[envKey] || 'Not set'}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingKey(envKey)
                            setKeyInput('')
                          }}
                        >
                          {provider.configured ? 'Change' : 'Add'}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </SettingsRow>
          ))}
      </SettingsSection>

      <SettingsSection
        title="Memory"
        description="Configure Hermes Agent memory and user profiles."
        icon={UserIcon}
      >
        <SettingsRow
          label="Memory enabled"
          description="Store and recall memories across sessions."
        >
          <Switch
            checked={memoryConfig.memory_enabled !== false}
            onCheckedChange={(checked: boolean) =>
              void saveConfig({
                config: { memory: { memory_enabled: checked } },
              })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="User profile"
          description="Remember user preferences and context."
        >
          <Switch
            checked={memoryConfig.user_profile_enabled !== false}
            onCheckedChange={(checked: boolean) =>
              void saveConfig({
                config: { memory: { user_profile_enabled: checked } },
              })
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Terminal"
        description="Shell execution settings."
        icon={SourceCodeSquareIcon}
      >
        <SettingsRow label="Backend" description="Terminal execution backend.">
          <span
            className="text-sm font-mono text-[var(--theme-muted)]"
          >
            {(terminalConfig.backend as string) || 'local'}
          </span>
        </SettingsRow>
        <SettingsRow
          label="Timeout"
          description="Max seconds for terminal commands."
        >
          <Input
            type="number"
            min={10}
            value={readNumber(terminalConfig.timeout, 180)}
            onChange={(e) =>
              saveNumberField('terminal', 'timeout', e.target.value, 180)
            }
            className="md:w-28"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Custom Providers"
        description="Configure a custom OpenAI-compatible endpoint. Add named rows (with a title like Qwen3.6.Eclipse) to custom_providers; optional manifest env key and URL below only apply if you use that path."
        icon={CloudIcon}
      >
        <div className="space-y-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
          <div>
            <p className="text-sm font-medium text-[var(--theme-text)]">Add custom provider</p>
            <p className="mt-1 text-xs text-[var(--theme-muted)]">
              <span className="font-medium">Title</span> is for your list only (e.g.{' '}
              <span className="font-mono">Qwen3.6.Eclipse</span> = model + host).{' '}
              <span className="font-medium">Provider id</span> is the config name Hermes uses — leave
              blank to derive a safe id from the title. Optional row API key is stored on this
              provider entry, not in .env.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs font-medium text-[var(--theme-muted)]">Title</span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={addCpTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setAddCpTitle(e.target.value)
                  }
                  placeholder="e.g. Qwen3.6.Eclipse"
                  className="font-mono text-sm sm:flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    setAddCpTitle(
                      suggestCustomProviderTitle(
                        modelInput,
                        addCpBaseUrl.trim() || baseUrlInput,
                      ),
                    )
                  }
                >
                  Suggest from model + URL
                </Button>
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-[var(--theme-muted)]">Provider id (optional)</span>
              <Input
                value={addCpProviderId}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setAddCpProviderId(e.target.value)
                }
                placeholder="e.g. ECLIPSE"
                className="font-mono text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-[var(--theme-muted)]">Base URL</span>
              <Input
                value={addCpBaseUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setAddCpBaseUrl(e.target.value)
                }
                placeholder="http://host:11434/v1"
                className="font-mono text-sm"
              />
            </label>
            <div className="md:col-span-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-0 py-0 text-xs text-[var(--theme-muted)] underline"
                onClick={() => {
                  setAddCpBaseUrl(baseUrlInput.trim())
                  setAddCpTitle((t) =>
                    t.trim()
                      ? t
                      : suggestCustomProviderTitle(modelInput, baseUrlInput.trim()),
                  )
                }}
              >
                Prefill from Model &amp; Provider above
              </Button>
            </div>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs font-medium text-[var(--theme-muted)]">
                Optional API key (this row only)
              </span>
              <Input
                type="password"
                value={addCpYamlKey}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setAddCpYamlKey(e.target.value)
                }
                placeholder="Leave blank if the server needs no key"
                className="font-mono text-sm"
              />
            </label>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => submitAddCustomProviderForm()}
          >
            Add to custom providers list
          </Button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--theme-border)] bg-white/90">
          <div className="flex flex-col gap-2 border-b border-[var(--theme-border)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--theme-muted)]">
              <span className="font-medium text-[var(--theme-text)]">Saved &amp; detected endpoints</span>
              <span className="text-[var(--theme-muted)]">
                {' '}
                (
                {customProviders.length +
                  (extraPrimaryNotInList ? 1 : 0) +
                  (extraManifestNotInList ? 1 : 0)}
                )
              </span>
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => saveCurrentToCustomProvidersList()}
            >
              Save current model setup to list
            </Button>
          </div>
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--theme-border)] bg-[var(--theme-hover)] text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Provider id</th>
                <th className="px-3 py-2">Base URL</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customProviders.length === 0 &&
              !extraPrimaryNotInList &&
              !extraManifestNotInList ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-4 text-xs leading-relaxed text-[var(--theme-muted)]"
                  >
                    No rows in <span className="font-mono">custom_providers</span> yet, and no
                    primary base URL or manifest URL was detected. Use{' '}
                    <span className="font-medium">Add custom provider</span>, or set Model &amp;
                    Provider and click &quot;Save current model setup to list&quot;.
                  </td>
                </tr>
              ) : null}
              {customProviders.map((raw, index) => {
                const entry = normalizeCustomProviderEntry(raw)
                const key = entry.name || `idx-${index}`
                return (
                  <tr
                    key={`saved-${key}-${index}`}
                    className="border-b border-[var(--theme-border)] odd:bg-[var(--theme-panel)]"
                  >
                    <td className="px-3 py-2 align-top text-xs text-[var(--theme-muted)]">Saved</td>
                    <td className="max-w-[160px] px-3 py-2 align-top text-xs font-medium text-[var(--theme-text)] break-words">
                      {entry.title || '—'}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs text-[var(--theme-text)]">
                      {entry.name || '—'}
                    </td>
                    <td className="max-w-[240px] px-3 py-2 align-top font-mono text-xs text-[var(--theme-muted)] break-all">
                      {entry.base_url || '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={saving || !entry.name}
                          onClick={() => applyCustomProviderFromList(raw)}
                        >
                          Apply
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-red-700 hover:text-red-800"
                          disabled={saving}
                          onClick={() => removeCustomProviderAt(index)}
                          aria-label={`Remove ${entry.name || 'custom provider'}`}
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.5} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {extraPrimaryNotInList ? (
                <tr className="border-b border-[var(--theme-border)] bg-amber-50/50">
                  <td className="px-3 py-2 align-top text-xs text-amber-900">Active (not in list)</td>
                  <td className="max-w-[160px] px-3 py-2 align-top text-xs text-[var(--theme-text)] break-words">
                    {suggestCustomProviderTitle(modelInput, extraPrimaryNotInList.base_url)}
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-xs font-medium text-[var(--theme-text)]">
                    {extraPrimaryNotInList.name}
                  </td>
                  <td className="max-w-[240px] px-3 py-2 align-top font-mono text-xs text-[var(--theme-muted)] break-all">
                    {extraPrimaryNotInList.base_url}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() => {
                          setProviderInput(extraPrimaryNotInList.name)
                          setBaseUrlInput(extraPrimaryNotInList.base_url)
                          void fetchModelsForProvider(extraPrimaryNotInList.name)
                        }}
                      >
                        Apply
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() =>
                          persistCustomProviderRow(
                            extraPrimaryNotInList.name,
                            extraPrimaryNotInList.base_url,
                            {
                              title: suggestCustomProviderTitle(
                                modelInput,
                                extraPrimaryNotInList.base_url,
                              ),
                            },
                          )
                        }
                      >
                        Add to list
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : null}
              {extraManifestNotInList ? (
                <tr className="border-b border-[var(--theme-border)] bg-sky-50/50">
                  <td className="px-3 py-2 align-top text-xs text-sky-900">Manifest block</td>
                  <td className="max-w-[160px] px-3 py-2 align-top text-xs text-[var(--theme-text)] break-words">
                    {(() => {
                      try {
                        const h = new URL(extraManifestNotInList.base_url).hostname
                        const short = h.split('.')[0] || h
                        return `Manifest.${short.charAt(0).toUpperCase()}${short.slice(1).toLowerCase()}`
                      } catch {
                        return 'Manifest'
                      }
                    })()}
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-xs text-[var(--theme-muted)]">
                    (env key path)
                  </td>
                  <td className="max-w-[240px] px-3 py-2 align-top font-mono text-xs text-[var(--theme-muted)] break-all">
                    {extraManifestNotInList.base_url}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        const u = extraManifestNotInList.base_url
                        persistCustomProviderRow(deriveCustomProviderNameFromBaseUrl(u), u, {
                          title: (() => {
                            try {
                              const h = new URL(u).hostname
                              const short = h.split('.')[0] || h
                              return `Manifest.${short.charAt(0).toUpperCase()}${short.slice(1).toLowerCase()}`
                            } catch {
                              return 'Manifest'
                            }
                          })(),
                        })
                      }}
                    >
                      Add to list
                    </Button>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <SettingsRow
          label="Manifest: CUSTOM_API_KEY"
          description={
            customApiKeyConfigured
              ? '✅ Saved in ~/.hermes/.env for the manifest OpenAI provider.'
              : customEndpointConfigured
                ? '○ Not set — optional when your endpoint is local or needs no env key.'
                : '○ Optional. Leave blank if you do not use providers.manifest + CUSTOM_API_KEY.'
          }
        >
          <div className="flex w-full max-w-sm flex-col gap-1">
            <p className="text-[11px] text-[var(--theme-muted)]">
              Leave blank if unused. Add only when your manifest integration requires this key.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                {editingCustomKey ? (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      type="password"
                      value={customApiKey}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setCustomApiKey(e.target.value)
                      }
                      placeholder="Leave blank to clear saved key"
                      className="min-w-[12rem] flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        void saveConfig({
                          env: {
                            CUSTOM_API_KEY: customApiKey.trim() ? customApiKey.trim() : null,
                          },
                        })
                        setEditingCustomKey(false)
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingCustomKey(false)}
                    >
                      ✕
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono text-[var(--theme-muted)]"
                    >
                      {customApiKeyConfigured
                        ? customProviderCatalogEntry?.maskedKeys['CUSTOM_API_KEY'] || 'Set'
                        : 'Not set'}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingCustomKey(true)
                        setCustomApiKey('')
                      }}
                    >
                      {customApiKeyConfigured ? 'Change' : 'Add'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Manifest: base URL"
          description={
            manifestBaseUrlOnly
              ? `✅ ${manifestBaseUrlOnly}`
              : '○ Optional — only if you use providers.manifest (separate from primary base URL).'
          }
        >
          <div className="flex w-full max-w-sm flex-col gap-1">
            <p className="text-[11px] text-[var(--theme-muted)]">
              This updates <span className="font-mono">providers.manifest</span> only. Primary model
              base URL stays under Model &amp; Provider.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                {editingCustomBaseUrl ? (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={customBaseUrl}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setCustomBaseUrl(e.target.value)
                      }
                      placeholder="http://127.0.0.1:8080/v1"
                      className="min-w-[12rem] flex-1 font-mono text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        const u = customBaseUrl.trim()
                        if (!u) {
                          setSaveMessage('Enter a manifest base URL, or cancel.')
                          setTimeout(() => setSaveMessage(null), 3000)
                          return
                        }
                        void saveConfig({
                          config: {
                            model: mergeModelForManifestSave(data.config, modelInput.trim()),
                            providers: {
                              manifest: {
                                type: 'openai',
                                base_url: u,
                                key_env: 'CUSTOM_API_KEY',
                              },
                            },
                          },
                        })
                        setEditingCustomBaseUrl(false)
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingCustomBaseUrl(false)
                        setCustomBaseUrl(manifestBaseUrlOnly)
                      }}
                    >
                      ✕
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono text-[var(--theme-muted)]"
                    >
                      {manifestBaseUrlOnly || 'Not set'}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCustomBaseUrl(manifestBaseUrlOnly)
                        setEditingCustomBaseUrl(true)
                      }}
                    >
                      {manifestBaseUrlOnly ? 'Edit' : 'Add'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="About"
        description="Hermes Agent runtime information."
        icon={Notification03Icon}
      >
        <SettingsRow
          label="Workspace version"
          description="Current web workspace release."
        >
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[var(--theme-accent)]/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--theme-accent)]">
              v{CHANGELOG[0].version}
            </span>
            <a
              href="/settings?section=whatsnew"
              className="text-xs text-[var(--theme-muted)] underline-offset-2 hover:text-[var(--theme-accent)] hover:underline"
            >
              What's New
            </a>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Config location"
          description="Where Claude stores its configuration."
        >
          <span
            className="text-xs font-mono text-[var(--theme-muted)]"
          >
            {data.claudeHome}
          </span>
        </SettingsRow>
        <SettingsRow
          label="Active provider"
          description="Current inference provider."
        >
          <span
            className="text-sm font-medium text-[var(--theme-accent)]"
          >
            {data.providers.find((p) => p.id === data.activeProvider)?.name ||
              data.activeProvider}
          </span>
        </SettingsRow>
      </SettingsSection>
    </>
  )

  const renderAgentBehavior = () => (
    <SettingsSection
      title="Agent Behavior"
      description="Control agent execution limits and tool access."
      icon={Settings02Icon}
    >
      <SettingsRow
        label="Max turns"
        description="Maximum agent turns per request (1-100)."
      >
        <Input
          type="number"
          min={1}
          max={100}
          value={readNumber(agentConfig.max_turns, 50)}
          onChange={(e) =>
            saveNumberField('agent', 'max_turns', e.target.value, 50)
          }
          className="md:w-28"
        />
      </SettingsRow>
      <SettingsRow
        label="Gateway timeout"
        description="Seconds before gateway times out a request."
      >
        <Input
          type="number"
          min={10}
          max={600}
          value={readNumber(agentConfig.gateway_timeout, 120)}
          onChange={(e) =>
            saveNumberField('agent', 'gateway_timeout', e.target.value, 120)
          }
          className="md:w-28"
        />
      </SettingsRow>
      <SettingsRow
        label="Tool use enforcement"
        description="Whether the agent must use tools when available."
      >
        <select
          value={(agentConfig.tool_use_enforcement as string) || 'auto'}
          onChange={(e) =>
            void saveConfig({
              config: { agent: { tool_use_enforcement: e.target.value } },
            })
          }
          className={selectClassName}
        >
          <option value="auto">auto</option>
          <option value="required">required</option>
          <option value="none">none</option>
        </select>
      </SettingsRow>
    </SettingsSection>
  )

  const renderSmartRouting = () => (
    <SettingsSection
      title="Smart Model Routing"
      description="Automatically route simple queries to cheaper models."
      icon={SparklesIcon}
    >
      <SettingsRow
        label="Enable smart routing"
        description="Route simple queries to a cheaper model automatically."
      >
        <Switch
          checked={readBoolean(smartRouting.enabled, false)}
          onCheckedChange={(checked) =>
            void saveConfig({
              config: { smart_model_routing: { enabled: checked } },
            })
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Cheap model"
        description="Model to use for simple queries."
      >
        <select
          value={(smartRouting.cheap_model as string) || ''}
          onChange={(e) =>
            void saveConfig({
              config: { smart_model_routing: { cheap_model: e.target.value } },
            })
          }
          className={selectClassName}
        >
          <option value="">Select model</option>
          {availableModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow
        label="Max simple chars"
        description="Messages shorter than this use the cheap model."
      >
        <Input
          type="number"
          min={1}
          value={readNumber(smartRouting.max_simple_chars, 500)}
          onChange={(e) =>
            saveNumberField(
              'smart_model_routing',
              'max_simple_chars',
              e.target.value,
              500,
            )
          }
          className="md:w-32"
        />
      </SettingsRow>
      <SettingsRow
        label="Max simple words"
        description="Messages with fewer words use the cheap model."
      >
        <Input
          type="number"
          min={1}
          value={readNumber(smartRouting.max_simple_words, 80)}
          onChange={(e) =>
            saveNumberField(
              'smart_model_routing',
              'max_simple_words',
              e.target.value,
              80,
            )
          }
          className="md:w-32"
        />
      </SettingsRow>
    </SettingsSection>
  )

  const renderVoice = () => (
    <div className="space-y-4">
      <SettingsSection
        title="Text-to-Speech"
        description="Configure voice output for agent responses."
        icon={VolumeHighIcon}
      >
        <SettingsRow
          label="TTS provider"
          description="Which TTS engine to use."
        >
          <select
            value={ttsProvider}
            onChange={(e) =>
              void saveConfig({ config: { tts: { provider: e.target.value } } })
            }
            className={selectClassName}
          >
            <option value="edge">Edge TTS (free)</option>
            <option value="elevenlabs">ElevenLabs</option>
            <option value="openai">OpenAI TTS</option>
            <option value="neutts">NeuTTS</option>
          </select>
        </SettingsRow>

        {ttsProvider === 'edge' && (
          <SettingsRow label="Voice" description="Edge voice name.">
            <Input
              value={(ttsEdge.voice as string) || ''}
              onChange={(e) =>
                void saveConfig({
                  config: { tts: { edge: { voice: e.target.value } } },
                })
              }
              placeholder="en-US-AriaNeural"
              className="md:w-64"
            />
          </SettingsRow>
        )}

        {ttsProvider === 'elevenlabs' && (
          <>
            <SettingsRow label="Voice ID" description="ElevenLabs voice_id.">
              <Input
                value={(ttsElevenLabs.voice_id as string) || ''}
                onChange={(e) =>
                  void saveConfig({
                    config: {
                      tts: { elevenlabs: { voice_id: e.target.value } },
                    },
                  })
                }
                className="md:w-64"
              />
            </SettingsRow>
            <SettingsRow label="Model" description="ElevenLabs model name.">
              <Input
                value={(ttsElevenLabs.model as string) || ''}
                onChange={(e) =>
                  void saveConfig({
                    config: { tts: { elevenlabs: { model: e.target.value } } },
                  })
                }
                className="md:w-64"
              />
            </SettingsRow>
          </>
        )}

        {ttsProvider === 'openai' && (
          <>
            <SettingsRow
              label="Voice"
              description="alloy, echo, fable, onyx, nova, shimmer"
            >
              <select
                value={(ttsOpenAi.voice as string) || 'alloy'}
                onChange={(e) =>
                  void saveConfig({
                    config: { tts: { openai: { voice: e.target.value } } },
                  })
                }
                className={selectClassName}
              >
                {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map(
                  (voice) => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ),
                )}
              </select>
            </SettingsRow>
            <SettingsRow label="Model" description="OpenAI TTS model.">
              <Input
                value={(ttsOpenAi.model as string) || ''}
                onChange={(e) =>
                  void saveConfig({
                    config: { tts: { openai: { model: e.target.value } } },
                  })
                }
                placeholder="tts-1"
                className="md:w-64"
              />
            </SettingsRow>
          </>
        )}
      </SettingsSection>

      <SettingsSection
        title="Speech-to-Text"
        description="Configure voice input recognition."
        icon={Mic01Icon}
      >
        <SettingsRow label="Enable STT" description="Turn on voice input.">
          <Switch
            checked={readBoolean(sttConfig.enabled, false)}
            onCheckedChange={(checked) =>
              void saveConfig({ config: { stt: { enabled: checked } } })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="STT provider"
          description="Which speech engine to use."
        >
          <select
            value={sttProvider}
            onChange={(e) =>
              void saveConfig({ config: { stt: { provider: e.target.value } } })
            }
            className={selectClassName}
          >
            {STT_PROVIDER_OPTIONS.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </SettingsRow>
        {sttProvider === 'local' && (
          <SettingsRow
            label="Model size"
            description="tiny, base, small, medium, large"
          >
            <select
              value={(sttLocal.model_size as string) || 'base'}
              onChange={(e) =>
                void saveConfig({
                  config: { stt: { local: { model_size: e.target.value } } },
                })
              }
              className={selectClassName}
            >
              {['tiny', 'base', 'small', 'medium', 'large'].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </SettingsRow>
        )}
        {sttProvider === 'groq' && (
          <>
            <SettingsRow
              label="Groq model"
              description="Choose the Whisper model Groq should run."
            >
              <select
                value={(sttGroq.model as string) || GROQ_STT_MODELS[0]}
                onChange={(e) =>
                  void saveConfig({
                    config: { stt: { groq: { ...sttGroq, model: e.target.value } } },
                  })
                }
                className={selectClassName}
              >
                {GROQ_STT_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </SettingsRow>
            <SettingsRow
              label="Language"
              description="Optional BCP-47 code, e.g. en or en-US. Leave blank for auto-detect."
            >
              <Input
                value={(sttConfig.language as string) || ''}
                onChange={(e) =>
                  void saveConfig({
                    config: { stt: { language: e.target.value } },
                  })
                }
                placeholder="auto"
                className="md:w-64"
              />
            </SettingsRow>
          </>
        )}
      </SettingsSection>
    </div>
  )

  const renderDisplay = () => (
    <SettingsSection
      title="Display"
      description="CLI display preferences reflected in the agent UI."
      icon={PaintBoardIcon}
    >
      <SettingsRow label="Personality" description="Agent response style.">
        <select
          value={(displayConfig.personality as string) || 'default'}
          onChange={(e) =>
            void saveConfig({
              config: { display: { personality: e.target.value } },
            })
          }
          className={selectClassName}
        >
          {['default', 'concise', 'verbose', 'creative'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow
        label="Streaming"
        description="Stream tokens as they arrive."
      >
        <Switch
          checked={readBoolean(displayConfig.streaming, true)}
          onCheckedChange={(checked) =>
            void saveConfig({ config: { display: { streaming: checked } } })
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Show reasoning"
        description="Expose model reasoning blocks in the UI."
      >
        <Switch
          checked={readBoolean(displayConfig.show_reasoning, false)}
          onCheckedChange={(checked) =>
            void saveConfig({
              config: { display: { show_reasoning: checked } },
            })
          }
        />
      </SettingsRow>
      <SettingsRow label="Show cost" description="Display usage cost metadata.">
        <Switch
          checked={readBoolean(displayConfig.show_cost, false)}
          onCheckedChange={(checked) =>
            void saveConfig({ config: { display: { show_cost: checked } } })
          }
        />
      </SettingsRow>
      <SettingsRow label="Compact" description="Use a denser display layout.">
        <Switch
          checked={readBoolean(displayConfig.compact, false)}
          onCheckedChange={(checked) =>
            void saveConfig({ config: { display: { compact: checked } } })
          }
        />
      </SettingsRow>
      <SettingsRow label="Skin" description="CLI theme skin.">
        <span
          className="text-sm font-mono text-[var(--theme-muted)]"
        >
          {(displayConfig.skin as string) || 'default'}
        </span>
      </SettingsRow>
    </SettingsSection>
  )

  const sectionContent = {
    claude: renderClaudeOverview(),
    agent: renderAgentBehavior(),
    routing: renderSmartRouting(),
    voice: renderVoice(),
    display: renderDisplay(),
  } as const

  return (
    <>
      {saveMessage && (
        <div
          className="rounded-lg px-3 py-2 text-sm font-medium"
          style={{
            backgroundColor: saveMessage.includes('Failed')
              ? 'rgba(239,68,68,0.15)'
              : 'rgba(34,197,94,0.15)',
            color: saveMessage.includes('Failed') ? '#ef4444' : '#22c55e',
          }}
        >
          {saveMessage}
        </div>
      )}
      {sectionContent[activeView]}
    </>
  )
}


