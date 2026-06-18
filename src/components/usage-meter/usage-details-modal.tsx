'use client'

import { useState } from 'react'
import {
  DialogClose,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatModelName } from '@/lib/format-model-name'

type ModelUsage = {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

type SessionUsage = {
  id: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  startedAt?: number
  updatedAt?: number
}

type UsageSummary = {
  inputTokens: number
  outputTokens: number
  contextPercent: number
  dailyCost: number
  models: Array<ModelUsage>
  sessions: Array<SessionUsage>
}

type UsageLine = {
  type: 'progress' | 'text' | 'badge'
  label: string
  used?: number
  limit?: number
  format?: 'percent' | 'dollars' | 'tokens'
  value?: string
  color?: string
  resetsAt?: string
}

type ProviderUsage = {
  provider: string
  displayName: string
  status: 'ok' | 'missing_credentials' | 'auth_expired' | 'error'
  message?: string
  plan?: string
  lines: Array<UsageLine>
  updatedAt: number
}

type UsageDetailsModalProps = {
  usage: UsageSummary
  error: string | null
  providerUsage: Array<ProviderUsage>
  providerError: string | null
  providerUpdatedAt: number | null
  onRefreshProviders?: () => Promise<void>
  preferredProvider?: string | null
  onSetPreferredProvider?: (provider: string) => void
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 10 ? 2 : 3,
  }).format(value)
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return Math.round(value).toString()
}

function formatTimestamp(value?: number): string {
  if (!value) return '—'
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatResetTime(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  if (diffMs <= 0) return 'resetting soon'
  const hours = Math.floor(diffMs / 3_600_000)
  const mins = Math.floor((diffMs % 3_600_000) / 60_000)
  if (hours > 0) return `resets in ${hours}h ${mins}m`
  return `resets in ${mins}m`
}

function progressColor(used: number, limit: number): string {
  const pct = (used / limit) * 100
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 75) return 'bg-amber-500'
  if (pct >= 50) return 'bg-yellow-500'
  return 'bg-emerald-500'
}

function formatLineValue(line: UsageLine): string {
  if (line.value) return line.value
  if (line.used === undefined) return '—'
  if (line.format === 'dollars') return `$${line.used.toFixed(2)}`
  if (line.format === 'percent') return `${Math.round(line.used)}%`
  if (line.format === 'tokens') return formatTokens(line.used)
  return String(line.used)
}

function ProviderLineRenderer({ line }: { line: UsageLine }) {
  if (
    line.type === 'progress' &&
    line.used !== undefined &&
    line.limit !== undefined
  ) {
    const pct = Math.min((line.used / line.limit) * 100, 100)
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--theme-muted)]">{line.label}</span>
          <span className="font-medium text-[var(--theme-text)]">
            {formatLineValue(line)}
            {line.limit && line.format === 'dollars'
              ? ` / $${line.limit.toFixed(2)}`
              : ''}
            {line.limit && line.format === 'percent' ? '' : ''}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-[var(--theme-hover)]">
          <div
            className={`h-2 rounded-full transition-all ${progressColor(line.used, line.limit)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {line.resetsAt ? (
          <div className="text-[10px] text-[var(--theme-muted)]">
            {formatResetTime(line.resetsAt)}
          </div>
        ) : null}
      </div>
    )
  }

  if (line.type === 'badge') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--theme-muted)]">{line.label}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            backgroundColor: line.color ? `${line.color}20` : '#f3f4f6',
            color: line.color ?? '#6b7280',
          }}
        >
          {line.value ?? '—'}
        </span>
      </div>
    )
  }

  // text
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[var(--theme-muted)]">{line.label}</span>
      <span className="font-medium text-[var(--theme-text)]">
        {formatLineValue(line)}
      </span>
    </div>
  )
}

function getActionableMessage(
  provider: string,
  status: ProviderUsage['status'],
  originalMessage?: string,
): string {
  if (status === 'auth_expired') {
    if (provider === 'claude' || provider === 'codex') {
      const cliCmd = provider === 'claude' ? 'claude' : 'codex'
      return `Run \`${cliCmd}\` in terminal to re-authenticate your session.`
    }
    if (provider === 'openai') {
      return 'Run `chatgpt` in terminal to refresh your ChatGPT session, or update your API key in Settings → Providers.'
    }
    return 'Re-authenticate your provider session or update your API key in Settings → Providers.'
  }

  if (status === 'missing_credentials') {
    return "Add your API key in Settings → Providers, or run the provider's CLI to authenticate."
  }

  if (status === 'error') {
    return "Check your network connection and try refreshing. If the issue persists, check the provider's status page."
  }

  return originalMessage || 'Provider data unavailable.'
}

function statusBadge(status: ProviderUsage['status']) {
  switch (status) {
    case 'ok':
      return (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          Connected
        </span>
      )
    case 'auth_expired':
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
          Auth Expired
        </span>
      )
    case 'missing_credentials':
      return (
        <span className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-muted)]">
          Not Configured
        </span>
      )
    case 'error':
      return (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
          Error
        </span>
      )
    default:
      return null
  }
}

function buildCsv(usage: UsageSummary): string {
  const rows: Array<string> = []
  rows.push('Usage Summary')
  rows.push('Metric,Value')
  rows.push(`Input Tokens,${usage.inputTokens}`)
  rows.push(`Output Tokens,${usage.outputTokens}`)
  rows.push(`Context %,${usage.contextPercent}`)
  rows.push(`Daily Cost,${usage.dailyCost}`)
  rows.push('')
  rows.push('Cost Per Model')
  rows.push('Model,Input Tokens,Output Tokens,Cost (USD)')
  usage.models.forEach((model) => {
    rows.push(
      `${model.model},${model.inputTokens},${model.outputTokens},${model.costUsd.toFixed(4)}`,
    )
  })
  rows.push('')
  rows.push('Session History')
  rows.push(
    'Session,Model,Input Tokens,Output Tokens,Cost (USD),Start,Last Updated',
  )
  usage.sessions.forEach((session) => {
    rows.push(
      `${session.id},${session.model},${session.inputTokens},${session.outputTokens},${session.costUsd.toFixed(4)},${formatTimestamp(session.startedAt)},${formatTimestamp(session.updatedAt)}`,
    )
  })
  return rows.join('\n')
}

// Map provider IDs to their model strings
export function UsageDetailsModal({
  usage,
  error,
  providerUsage,
  providerError,
  providerUpdatedAt,
  onRefreshProviders,
  preferredProvider,
  onSetPreferredProvider,
}: UsageDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'session' | 'providers'>(
    'providers',
  )
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleSetDefault = (provider: string) => {
    onSetPreferredProvider?.(provider)
  }

  const handleRefreshProvider = async () => {
    setIsRefreshing(true)
    try {
      // Force refresh provider data without page reload
      const res = await fetch('/api/provider-usage?force=1')
      if (res.ok && onRefreshProviders) {
        await onRefreshProviders()
      }
      setIsRefreshing(false)
    } catch (refreshError) {
      if (import.meta.env.DEV)
        console.error('Failed to refresh provider data:', refreshError)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleExport = () => {
    const csv = buildCsv(usage)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `usage-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex max-h-[80vh] flex-col gap-4 overflow-hidden p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <DialogTitle>Usage Overview</DialogTitle>
          <DialogDescription>
            Live usage from your gateway session and connected providers.
          </DialogDescription>
        </div>
        <DialogClose className="text-[var(--theme-muted)]">Close</DialogClose>
      </div>

      <div className="flex w-fit items-center gap-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] p-1 text-xs">
        {(['session', 'providers'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-full px-3 py-1 font-medium transition ${
              activeTab === tab
                ? 'bg-[var(--theme-hover)] text-[var(--theme-text)] shadow-sm'
                : 'text-[var(--theme-muted)] hover:text-[var(--theme-text)]'
            }`}
          >
            {tab === 'session' ? 'Session' : 'Providers'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'session' ? (
          <div className="flex flex-col gap-4">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3">
                <div className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                  Input Tokens
                </div>
                <div className="text-xl font-semibold text-[var(--theme-text)]">
                  {formatTokens(usage.inputTokens)}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3">
                <div className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                  Output Tokens
                </div>
                <div className="text-xl font-semibold text-[var(--theme-text)]">
                  {formatTokens(usage.outputTokens)}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3">
                <div className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                  Daily Cost
                </div>
                <div className="text-xl font-semibold text-[var(--theme-text)]">
                  {formatCurrency(usage.dailyCost)}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
              <div className="mb-3 text-sm font-semibold text-[var(--theme-text)]">
                Cost per model
              </div>
              <div className="grid gap-2">
                {usage.models.length === 0 ? (
                  <div className="text-sm text-[var(--theme-muted)]">
                    No model usage reported yet. Send a message to start tracking usage here.
                  </div>
                ) : (
                  usage.models.map((model) => (
                    <div
                      key={model.model}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-sm"
                    >
                      <div className="font-medium text-[var(--theme-text)]">
                        {formatModelName(model.model)}
                      </div>
                      <div className="text-[var(--theme-muted)]">
                        {formatTokens(model.inputTokens)} in ·{' '}
                        {formatTokens(model.outputTokens)} out
                      </div>
                      <div className="font-semibold text-[var(--theme-text)]">
                        {formatCurrency(model.costUsd)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
              <div className="mb-3 text-sm font-semibold text-[var(--theme-text)]">
                Session history
              </div>
              <div className="grid gap-2">
                {usage.sessions.length === 0 ? (
                  <div className="text-sm text-[var(--theme-muted)]">
                    No sessions reported yet. Start a chat to see session history here.
                  </div>
                ) : (
                  usage.sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-sm"
                    >
                      <div>
                        <div className="font-medium text-[var(--theme-text)]">
                          {session.id}
                        </div>
                        <div className="text-xs text-[var(--theme-muted)]">
                          {formatModelName(session.model)}
                        </div>
                      </div>
                      <div className="text-[var(--theme-muted)]">
                        {formatTokens(session.inputTokens)} in ·{' '}
                        {formatTokens(session.outputTokens)} out
                      </div>
                      <div className="text-xs text-[var(--theme-muted)]">
                        {formatTimestamp(session.startedAt)} →{' '}
                        {formatTimestamp(session.updatedAt)}
                      </div>
                      <div className="font-semibold text-[var(--theme-text)]">
                        {formatCurrency(session.costUsd)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[var(--theme-muted)]">
                Context usage: {Math.round(usage.contextPercent)}%
              </div>
              <Button size="sm" variant="outline" onClick={handleExport}>
                Export CSV
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {providerError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {providerError}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-[var(--theme-muted)]">
                Auto-polls every 30s · Last updated{' '}
                {formatTimestamp(providerUpdatedAt ?? undefined)}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefreshProvider}
                disabled={isRefreshing}
              >
                {isRefreshing ? 'Refreshing...' : '🔄 Refresh'}
              </Button>
            </div>

            <div className="grid gap-3">
              {providerUsage.length === 0 ? (
                <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-6 text-center">
                  <div className="text-sm font-medium text-[var(--theme-muted)]">
                    No providers connected. Add a provider in Settings to start chatting.
                  </div>
                  <div className="mt-1 text-xs text-[var(--theme-muted)]">
                    Open Settings -{'>'} Providers to connect Claude CLI or add an API key.
                  </div>
                </div>
              ) : (
                providerUsage.map((provider) => {
                  const isDefault = preferredProvider === provider.provider

                  return (
                    <div
                      key={provider.provider}
                      className={`rounded-2xl border p-4 ${
                        isDefault
                          ? 'border-[var(--theme-border)] bg-[var(--theme-panel)]'
                          : 'border-[var(--theme-border)] bg-[var(--theme-panel)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-[var(--theme-text)]">
                            {provider.displayName}
                          </div>
                          {provider.plan ? (
                            <span className="rounded-full bg-[var(--theme-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-muted)]">
                              {provider.plan}
                            </span>
                          ) : null}
                          {isDefault ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              ⭐ Default
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {statusBadge(provider.status)}
                          <span className="text-[10px] text-[var(--theme-muted)]">
                            {formatTimestamp(provider.updatedAt)}
                          </span>
                        </div>
                      </div>

                      {provider.status !== 'ok' ? (
                        <div className="mt-3 space-y-2">
                          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
                            {getActionableMessage(
                              provider.provider,
                              provider.status,
                              provider.message,
                            )}
                          </div>
                          {provider.message &&
                          provider.message !==
                            getActionableMessage(
                              provider.provider,
                              provider.status,
                              provider.message,
                            ) ? (
                            <div className="text-[10px] text-[var(--theme-muted)]">
                              Details: {provider.message}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <div className="flex-1"></div>
                            {!isDefault ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleSetDefault(provider.provider)
                                }
                                className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-1.5 text-xs font-medium text-[var(--theme-muted)] transition hover:bg-[var(--theme-hover)]"
                              >
                                Set as Default
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-3 space-y-3">
                            {provider.lines.map((line, i) => (
                              <ProviderLineRenderer
                                key={`${line.label}-${i}`}
                                line={line}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
