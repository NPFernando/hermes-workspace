import {
  DEFAULT_STREAM_READ_TIMEOUT_SECONDS,
  DEFAULT_STREAM_STALE_TIMEOUT_SECONDS,
  MEMORY_FALLBACK_OPTIONS,
  MEMORY_PROVIDER_OPTIONS,
  MODEL_PROVIDER_VALUES,
} from './types'
import type { ModelCatalogEntry } from '@/lib/model-types'
import type {
  ClaudeCatalogEntry,
  ClaudeConfig,
  ModelConfigDraft,
  ModelProviderOption,
  PerformanceDraft,
  ProviderSummary,
  SelectOption,
  SettingDefinition,
} from './types'
import {
  getProviderDisplayName,
  getProviderInfo,
  normalizeProviderId,
} from '@/lib/provider-catalog'

export const KNOWN_PROVIDER_PREFIXES = [
  'openrouter',
  'anthropic',
  'openai',
  'openai-codex',
  'google',
  'nous',
  'ollama',
  'atomic-chat',
  'zai',
  'kimi-coding',
  'minimax',
  'minimax-cn',
]

export function stripProviderPrefix(model: string): string {
  if (!model) return model
  const slash = model.indexOf('/')
  if (slash === -1) return model
  const prefix = model.slice(0, slash)
  if (KNOWN_PROVIDER_PREFIXES.includes(prefix)) {
    return model.slice(slash + 1)
  }
  return model
}


export function formatStringList(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .join('\n')
}

export function parseStringList(value: string): Array<string> {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function readProviderId(entry: ModelCatalogEntry): string | null {
  if (typeof entry === 'string') return null
  const provider = typeof entry.provider === 'string' ? entry.provider : ''
  const normalized = normalizeProviderId(provider)
  return normalized || null
}

export function buildProviderSummaries(payload: {
  models?: Array<ModelCatalogEntry>
  configuredProviders?: Array<string>
}): Array<ProviderSummary> {
  const modelCounts = new Map<string, number>()

  for (const entry of payload.models ?? []) {
    const providerId = readProviderId(entry)
    if (!providerId) continue

    const current = modelCounts.get(providerId) ?? 0
    modelCounts.set(providerId, current + 1)
  }

  const configuredSet = new Set<string>()
  for (const providerId of payload.configuredProviders ?? []) {
    const normalized = normalizeProviderId(providerId)
    if (normalized) configuredSet.add(normalized)
  }

  for (const providerId of modelCounts.keys()) {
    configuredSet.add(providerId)
  }

  const summaries: Array<ProviderSummary> = []

  for (const providerId of configuredSet) {
    const metadata = getProviderInfo(providerId)
    const modelCount = modelCounts.get(providerId) ?? 0

    summaries.push({
      id: providerId,
      name: getProviderDisplayName(providerId),
      description:
        metadata?.description ||
        'Configured provider in your local Hermes setup.',
      modelCount,
      status: modelCount > 0 ? 'active' : 'configured',
    })
  }

  summaries.sort(function sortByName(a, b) {
    return a.name.localeCompare(b.name)
  })

  return summaries
}

export function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, source)
}

export function coerceBoolean(value: unknown): boolean {
  return value === true
}

export function coerceString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function coerceNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : ''
}

export function defaultFormatValue(
  setting: SettingDefinition,
  value: unknown,
): string {
  if (setting.kind === 'number') return coerceNumber(value)
  if (setting.kind === 'boolean') return coerceBoolean(value) ? 'true' : 'false'
  return coerceString(value)
}

export function getDraftValue(
  setting: SettingDefinition,
  config: ClaudeConfig | undefined,
  draftValues: Record<string, string>,
): string {
  if (draftValues[setting.id] !== undefined) return draftValues[setting.id]
  if (!setting.path) return ''
  const rawValue = readPath(config, setting.path)
  if (setting.formatter) return setting.formatter(rawValue)
  return defaultFormatValue(setting, rawValue)
}

export function parseTextValue(setting: SettingDefinition, rawValue: string): unknown {
  if (setting.parser) return setting.parser(rawValue)
  return rawValue.trim()
}

export function parseNumberValue(rawValue: string): number | null {
  const trimmed = rawValue.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildModelOptions(
  models: Array<ModelCatalogEntry>,
): Array<SelectOption> {
  const seen = new Set<string>()
  const options: Array<SelectOption> = []

  for (const entry of models) {
    const modelId =
      typeof entry === 'string'
        ? entry
        : typeof entry.id === 'string'
          ? entry.id
          : typeof entry.alias === 'string'
            ? entry.alias
            : typeof entry.model === 'string'
              ? entry.model
              : ''

    if (!modelId.trim() || seen.has(modelId)) continue
    seen.add(modelId)

    const label =
      typeof entry === 'string'
        ? entry
        : typeof entry.displayName === 'string'
          ? entry.displayName
          : typeof entry.label === 'string'
            ? entry.label
            : typeof entry.name === 'string'
              ? entry.name
              : modelId

    options.push({ label, value: modelId })
  }

  options.sort(function sortOptions(a, b) {
    return a.label.localeCompare(b.label)
  })

  return options
}

export function searchMatchesSetting(
  setting: SettingDefinition,
  query: string,
): boolean {
  const haystack = [
    setting.label,
    setting.description,
    setting.path,
    setting.tab,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(query)
}


export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function parseModelProvider(value: unknown): ModelProviderOption {
  return typeof value === 'string' &&
    MODEL_PROVIDER_VALUES.has(value as ModelProviderOption)
    ? (value as ModelProviderOption)
    : 'custom'
}

export function readPrimaryModelConfig(
  config: ClaudeConfig | undefined,
): ModelConfigDraft {
  const modelBlock = readRecord(config?.model)
  const flatModel = typeof config?.model === 'string' ? config.model : ''

  return {
    provider: parseModelProvider(modelBlock?.provider ?? config?.provider),
    model: coerceString(modelBlock?.default ?? flatModel),
    baseUrl: coerceString(modelBlock?.base_url ?? config?.base_url),
  }
}

export function readFallbackModelConfig(
  config: ClaudeConfig | undefined,
): ModelConfigDraft {
  const fallbackBlock = readRecord(config?.fallback_model)

  return {
    provider: parseModelProvider(fallbackBlock?.provider),
    model: coerceString(fallbackBlock?.model),
    baseUrl: coerceString(fallbackBlock?.base_url),
  }
}

export function readPerformanceConfig(
  config: ClaudeConfig | undefined,
): PerformanceDraft {
  const performanceBlock = readRecord(config?.performance)
  const staleTimeout =
    performanceBlock?.stream_stale_timeout ?? config?.stream_stale_timeout
  const readTimeout =
    performanceBlock?.stream_read_timeout ?? config?.stream_read_timeout

  return {
    streamStaleTimeout:
      typeof staleTimeout === 'number' && Number.isFinite(staleTimeout)
        ? String(staleTimeout)
        : String(DEFAULT_STREAM_STALE_TIMEOUT_SECONDS),
    streamReadTimeout:
      typeof readTimeout === 'number' && Number.isFinite(readTimeout)
        ? String(readTimeout)
        : String(DEFAULT_STREAM_READ_TIMEOUT_SECONDS),
  }
}

export function hasModelConfigValue(value: ModelConfigDraft): boolean {
  return Boolean(value.model.trim() || value.baseUrl.trim())
}

export function parseTimeoutInput(value: string, fallback: number): number {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function isClaudeCatalogEntry(
  entry: ClaudeCatalogEntry | null,
): entry is ClaudeCatalogEntry {
  return entry !== null
}

export async function fetchModels(): Promise<{
  ok?: boolean
  models?: Array<ModelCatalogEntry>
  configuredProviders?: Array<string>
}> {
  const response = await fetch('/api/models')
  if (!response.ok) {
    throw new Error(`Models request failed (${response.status})`)
  }

  const payload = (await response.json()) as
    | Array<unknown>
    | {
        data?: Array<Record<string, unknown>>
        models?: Array<Record<string, unknown>>
      }
  const rawModels = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : []

  const models = rawModels
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const id =
        typeof record.id === 'string'
          ? record.id.trim()
          : typeof record.name === 'string'
            ? record.name.trim()
            : typeof record.model === 'string'
              ? record.model.trim()
              : ''
      if (!id) return null
      const provider =
        typeof record.provider === 'string' && record.provider.trim()
          ? record.provider.trim()
          : typeof record.owned_by === 'string' && record.owned_by.trim()
            ? record.owned_by.trim()
            : id.includes('/')
              ? id.split('/')[0]
              : 'hermes-agent'

      return {
        ...record,
        id,
        provider,
        name:
          typeof record.name === 'string' && record.name.trim()
            ? record.name.trim()
            : typeof record.display_name === 'string' &&
                record.display_name.trim()
              ? record.display_name.trim()
              : typeof record.label === 'string' && record.label.trim()
                ? record.label.trim()
                : id,
      }
    })
    .filter(isClaudeCatalogEntry)

  const configuredProviders = Array.from(
    new Set(
      models.flatMap((entry) => {
        if (typeof entry === 'string') return []
        return typeof entry.provider === 'string' && entry.provider
          ? [entry.provider]
          : []
      }),
    ),
  )

  return {
    ok: true,
    models: models as Array<ModelCatalogEntry>,
    configuredProviders,
  }
}


export const SETTINGS: Array<SettingDefinition> = [
  {
    id: 'primary-model',
    tab: 'models',
    path: 'model.default',
    label: 'Default model',
    description:
      'Backend default model used when a chat does not select a per-session override.',
    kind: 'text',
    placeholder: 'provider/model',
  },
  {
    id: 'fallback-chain',
    tab: 'models',
    path: 'agents.defaults.model.fallbacks',
    label: 'Fallback chain',
    description:
      'Ordered fallback models. Use one per line or separate with commas.',
    kind: 'multiline',
    rows: 3,
    placeholder: 'anthropic-oauth/claude-sonnet-4-6',
    formatter: formatStringList,
    parser: parseStringList,
  },
  {
    id: 'context-tokens-models',
    tab: 'models',
    path: 'agents.defaults.contextTokens',
    label: 'Context tokens',
    description:
      'Default token budget applied to agents when no narrower override is present.',
    kind: 'number',
    min: 1,
    step: 1000,
  },
  // Thinking/reasoning settings removed — not supported by Hermes Agent
  // Legacy settings removed: bootstrap, block streaming,
  // compaction, thinking, verbose, and fast mode do not apply here.
  {
    id: 'context-tokens-session',
    tab: 'session',
    path: 'agents.defaults.contextTokens',
    label: 'Session context tokens',
    description:
      'Same agent default context budget surfaced here for session setup workflows.',
    kind: 'number',
    min: 1,
    step: 1000,
  },
  {
    id: 'memory-provider',
    tab: 'memory',
    path: 'agents.defaults.memorySearch.provider',
    label: 'Memory search provider',
    description: 'Embedding provider used for memory lookup and consolidation.',
    kind: 'select',
    options: MEMORY_PROVIDER_OPTIONS,
  },
  {
    id: 'memory-fallback',
    tab: 'memory',
    path: 'agents.defaults.memorySearch.fallback',
    label: 'Memory fallback provider',
    description:
      'Fallback provider when the primary memory search provider is unavailable.',
    kind: 'select',
    options: MEMORY_FALLBACK_OPTIONS,
  },
  {
    id: 'memory-sync-on-session-start',
    tab: 'memory',
    path: 'agents.defaults.memorySearch.sync.onSessionStart',
    label: 'Sync on session start',
    description: 'Refresh indexed memory paths when a new session starts.',
    kind: 'boolean',
  },
  {
    id: 'memory-sync-on-search',
    tab: 'memory',
    path: 'agents.defaults.memorySearch.sync.onSearch',
    label: 'Sync on search',
    description: 'Run a sync before memory search queries.',
    kind: 'boolean',
  },
  {
    id: 'memory-sync-interval',
    tab: 'memory',
    path: 'agents.defaults.memorySearch.sync.intervalMinutes',
    label: 'Consolidation interval',
    description: 'Background memory consolidation cadence, in minutes.',
    kind: 'number',
    min: 0,
    step: 5,
  },
]


