export type ProviderStatus = 'active' | 'configured'
export type SettingsTabId = 'providers' | 'models' | 'agents' | 'session' | 'memory'
export type SettingKind = 'text' | 'number' | 'select' | 'boolean' | 'multiline'

export type ProviderSummary = {
  id: string
  name: string
  description: string
  modelCount: number
  status: ProviderStatus
}

export type ProvidersScreenProps = {
  embedded?: boolean
}

export type ClaudeConfig = Record<string, unknown>

export type ConfigQueryResponse = {
  ok?: boolean
  payload?: ClaudeConfig
  error?: string
}

export type ConfigPatchResponse = {
  ok?: boolean
  error?: string
}

export type SelectOption = {
  label: string
  value: string
}

export type SettingDefinition = {
  id: string
  tab: SettingsTabId
  label: string
  description: string
  path?: string
  kind: SettingKind
  options?: Array<SelectOption>
  placeholder?: string
  min?: number
  step?: number
  rows?: number
  unsupported?: boolean
  formatter?: (value: unknown) => string
  parser?: (value: string) => unknown
}

export type SaveSettingPayload = {
  path: string
  value: unknown
  label: string
}

// Models are fetched through the workspace API proxy to support Docker and
// reverse-proxy deployments where the browser cannot reach Hermes Agent directly.

export type ClaudeCatalogEntry =
  | string
  | {
      id: string
      provider: string
      name: string
      [key: string]: unknown
    }


export const TAB_ORDER: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
  { id: 'agents', label: 'AI & Agents' },
  { id: 'session', label: 'Session' },
  { id: 'memory', label: 'Memory' },
]

export const MEMORY_PROVIDER_OPTIONS: Array<SelectOption> = [
  { label: 'Local', value: 'local' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'Voyage', value: 'voyage' },
  { label: 'Mistral', value: 'mistral' },
  { label: 'Ollama', value: 'ollama' },
]

export const MEMORY_FALLBACK_OPTIONS: Array<SelectOption> = [
  { label: 'None', value: 'none' },
  ...MEMORY_PROVIDER_OPTIONS,
]

export type ModelProviderOption =
  | 'custom'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'

export type ModelConfigDraft = {
  provider: ModelProviderOption
  model: string
  baseUrl: string
}

export type PerformanceDraft = {
  streamStaleTimeout: string
  streamReadTimeout: string
}

export const MODEL_PROVIDER_OPTIONS: Array<SelectOption> = [
  { label: 'Custom', value: 'custom' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Google (Gemini)', value: 'google' },
]

export const MODEL_PRESETS = [
  {
    id: 'atomic-chat',
    label: 'Atomic Chat',
    provider: 'custom' as const,
    baseUrl: 'http://127.0.0.1:1337/v1',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    provider: 'custom' as const,
    baseUrl: 'http://127.0.0.1:11434/v1',
  },
  {
    id: 'llama-server',
    label: 'llama-server',
    provider: 'custom' as const,
    baseUrl: 'http://127.0.0.1:8080/v1',
  },
]

export const DEFAULT_STREAM_STALE_TIMEOUT_SECONDS = 90
export const DEFAULT_STREAM_READ_TIMEOUT_SECONDS = 60
export const MODEL_PROVIDER_VALUES = new Set<ModelProviderOption>(
  MODEL_PROVIDER_OPTIONS.map((option) => option.value as ModelProviderOption),
)

