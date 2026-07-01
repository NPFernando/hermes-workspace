import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { hasModelConfigValue, parseModelProvider, parseTimeoutInput, readFallbackModelConfig, readPerformanceConfig, readPrimaryModelConfig, stripProviderPrefix } from './utils'
import {
  DEFAULT_STREAM_READ_TIMEOUT_SECONDS,
  DEFAULT_STREAM_STALE_TIMEOUT_SECONDS,
  MODEL_PRESETS,
  MODEL_PROVIDER_OPTIONS,
} from './types'
import type { ClaudeConfig, ModelConfigDraft, PerformanceDraft, SelectOption } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'

async function getConfig(): Promise<Record<string, unknown>> {
  const res = await fetch('/api/claude-config')
  if (!res.ok) throw new Error(`Failed to load config: HTTP ${res.status}`)
  const data = await res.json() as { config?: Record<string, unknown> }
  return data.config ?? {}
}

async function patchConfig(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/claude-config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: patch }),
  })
  if (!res.ok) throw new Error(`Failed to save config: HTTP ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

export function ModelConfigSection(props: {
  title: string
  description: string
  value: ModelConfigDraft
  onChange: (nextValue: ModelConfigDraft) => void
  modelOptions: Array<SelectOption>
  showPresets?: boolean
  datalistId: string
}) {
  const {
    title,
    description,
    value,
    onChange,
    modelOptions,
    showPresets = false,
    datalistId,
  } = props

  return (
    <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--theme-text)]">{title}</h3>
        <p className="text-sm text-[var(--theme-muted)]">{description}</p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--theme-muted)]">
            Provider
          </span>
          <select
            className="h-10 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 text-sm text-[var(--theme-text)] outline-none"
            value={value.provider}
            onChange={(event) => {
              onChange({
                ...value,
                provider: parseModelProvider(event.target.value),
              })
            }}
          >
            {MODEL_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--theme-muted)]">
            Model Name
          </span>
          <Input
            value={value.model}
            list={datalistId}
            placeholder="gpt-4.1, claude-sonnet-4-5, qwen2.5:32b"
            className="border-[var(--theme-border)] bg-[var(--theme-card)] font-mono text-sm"
            onChange={(event) => {
              onChange({
                ...value,
                model: event.target.value,
              })
            }}
          />
        </label>
      </div>

      <label className="mt-4 block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--theme-muted)]">
          Base URL
        </span>
        <Input
          value={value.baseUrl}
          placeholder="http://127.0.0.1:11434/v1"
          className="border-[var(--theme-border)] bg-[var(--theme-card)] font-mono text-sm"
          onChange={(event) => {
            onChange({
              ...value,
              baseUrl: event.target.value,
            })
          }}
        />
      </label>

      {showPresets ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {MODEL_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              className="border-[var(--theme-border)] bg-[var(--theme-card)]"
              onClick={() => {
                onChange({
                  ...value,
                  provider: preset.provider,
                  baseUrl: preset.baseUrl,
                })
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      ) : null}

      <datalist id={datalistId}>
        {modelOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </datalist>
    </section>
  )
}

export function ActiveModelCard({
  modelOptions,
}: {
  modelOptions: Array<SelectOption>
}) {
  const queryClient = useQueryClient()
  const [primaryConfig, setPrimaryConfig] = useState<ModelConfigDraft>({
    provider: 'custom',
    model: '',
    baseUrl: '',
  })
  const [fallbackConfig, setFallbackConfig] = useState<ModelConfigDraft>({
    provider: 'custom',
    model: '',
    baseUrl: '',
  })
  const [performanceConfig, setPerformanceConfig] = useState<PerformanceDraft>({
    streamStaleTimeout: String(DEFAULT_STREAM_STALE_TIMEOUT_SECONDS),
    streamReadTimeout: String(DEFAULT_STREAM_READ_TIMEOUT_SECONDS),
  })
  const [showFallback, setShowFallback] = useState(false)

  const configQuery = useQuery({
    queryKey: ['claude', 'active-config'],
    queryFn: getConfig,
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const normalizedPrimaryModel = stripProviderPrefix(
        primaryConfig.model.trim(),
      )
      const normalizedFallbackModel = stripProviderPrefix(
        fallbackConfig.model.trim(),
      )
      const streamStaleTimeout = parseTimeoutInput(
        performanceConfig.streamStaleTimeout,
        DEFAULT_STREAM_STALE_TIMEOUT_SECONDS,
      )
      const streamReadTimeout = parseTimeoutInput(
        performanceConfig.streamReadTimeout,
        DEFAULT_STREAM_READ_TIMEOUT_SECONDS,
      )

      const patch: Record<string, unknown> = {
        model: normalizedPrimaryModel,
        provider: primaryConfig.provider,
        base_url: primaryConfig.baseUrl.trim(),
        stream_stale_timeout: streamStaleTimeout,
        stream_read_timeout: streamReadTimeout,
        performance: {
          stream_stale_timeout: streamStaleTimeout,
          stream_read_timeout: streamReadTimeout,
        },
      }

      patch.fallback_model = hasModelConfigValue(fallbackConfig)
        ? {
            provider: fallbackConfig.provider,
            model: normalizedFallbackModel,
            base_url: fallbackConfig.baseUrl.trim(),
          }
        : null

      await patchConfig(patch)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['claude', 'active-config'],
        }),
        queryClient.invalidateQueries({ queryKey: ['claude', 'config'] }),
        queryClient.invalidateQueries({ queryKey: ['claude-config'] }),
      ])
      toast('Model config saved — takes effect on next message', {
        type: 'success',
      })
    },
    onError: (error) => {
      toast(
        error instanceof Error ? error.message : 'Failed to save model config',
        { type: 'error' },
      )
    },
  })

  useEffect(() => {
    if (!configQuery.data) return
    setPrimaryConfig(readPrimaryModelConfig(configQuery.data))
    setFallbackConfig(readFallbackModelConfig(configQuery.data))
    setPerformanceConfig(readPerformanceConfig(configQuery.data))
  }, [configQuery.data])

  return (
    <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-medium text-[var(--theme-text)]">
            Model Configuration
          </h3>
          <p className="text-sm text-[var(--theme-muted)]">
            Update the primary model, optional fallback, and stream timeout
            settings saved in the active profile configuration.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => void saveMutation.mutateAsync()}
          disabled={configQuery.isPending || saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {configQuery.isPending ? (
        <p className="mt-4 text-sm text-[var(--theme-muted)]">
          Loading configuration...
        </p>
      ) : configQuery.error ? (
        <p className="mt-4 text-sm text-red-500">
          Could not load config — is Hermes Agent running?
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <ModelConfigSection
            title="Primary Model"
            description="Default provider, model, and base URL used for new Hermes Agent requests."
            value={primaryConfig}
            onChange={setPrimaryConfig}
            modelOptions={modelOptions}
            showPresets
            datalistId="settings-primary-model-options"
          />

          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-[var(--theme-text)]">
                  Fallback Model
                </h3>
                <p className="text-sm text-[var(--theme-muted)]">
                  Optional secondary model Hermes Agent can use if the primary path
                  fails.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-[var(--theme-border)] bg-[var(--theme-card)]"
                onClick={() => {
                  setShowFallback((current) => !current)
                }}
              >
                {showFallback ? 'Hide Fallback' : 'Show Fallback'}
              </Button>
            </div>

            {showFallback ? (
              <div className="mt-4">
                <ModelConfigSection
                  title="Fallback Settings"
                  description="Keep these fields empty if you do not want a fallback model configured."
                  value={fallbackConfig}
                  onChange={setFallbackConfig}
                  modelOptions={modelOptions}
                  datalistId="settings-fallback-model-options"
                />
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--theme-text)]">
                Performance
              </h3>
              <p className="text-sm text-[var(--theme-muted)]">
                Increase these timeouts for slower local models or larger
                prompts that stream output more gradually.
              </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--theme-muted)]">
                  Stream Stale Timeout
                </span>
                <Input
                  type="number"
                  min={1}
                  value={performanceConfig.streamStaleTimeout}
                  className="border-[var(--theme-border)] bg-[var(--theme-card)] text-sm"
                  onChange={(event) => {
                    setPerformanceConfig((current) => ({
                      ...current,
                      streamStaleTimeout: event.target.value,
                    }))
                  }}
                />
                <p className="text-xs text-[var(--theme-muted)]">Default: 90s</p>
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--theme-muted)]">
                  Stream Read Timeout
                </span>
                <Input
                  type="number"
                  min={1}
                  value={performanceConfig.streamReadTimeout}
                  className="border-[var(--theme-border)] bg-[var(--theme-card)] text-sm"
                  onChange={(event) => {
                    setPerformanceConfig((current) => ({
                      ...current,
                      streamReadTimeout: event.target.value,
                    }))
                  }}
                />
                <p className="text-xs text-[var(--theme-muted)]">Default: 60s</p>
              </label>
            </div>

            <p className="mt-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-muted)]">
              Slow local runners such as Ollama and `llama-server` often need
              more headroom before Hermes Agent decides a stream has stalled.
            </p>
          </section>
        </div>
      )}
    </section>
  )
}

