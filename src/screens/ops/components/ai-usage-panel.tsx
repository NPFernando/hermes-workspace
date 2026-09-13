import { useQuery } from '@tanstack/react-query'

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

type ProviderUsageResponse = {
  ok: boolean
  updatedAt: number
  providers: Array<ProviderUsage>
  error?: string
}

type HermesModelUsage = {
  sessions: number
  tokens: number
}

type CopilotUsage = {
  requests24h: number
  requests7d: number
  sessions7d: number
  inputTokens7d: number
  outputTokens7d: number
  aiu7d: number
  lastEventAt: string | null
}

export type QuotaAlert = 'limit' | 'critical' | 'warning' | null

export function quotaAlert(line: UsageLine): QuotaAlert {
  if (
    line.type !== 'progress' ||
    line.used === undefined ||
    line.limit === undefined ||
    line.limit <= 0
  ) {
    return null
  }

  const percent = (line.used / line.limit) * 100
  if (percent >= 100) return 'limit'
  if (percent >= 90) return 'critical'
  if (percent >= 75) return 'warning'
  return null
}

function usageValue(line: UsageLine): string {
  if (line.value) return line.value
  if (line.used === undefined) return '—'
  if (line.format === 'dollars') return `$${line.used.toFixed(2)}`
  if (line.format === 'percent') return `${Math.round(line.used)}%`
  if (line.format === 'tokens') return line.used.toLocaleString()
  return String(line.used)
}

function providerStatus(status: ProviderUsage['status']): string {
  switch (status) {
    case 'ok':
      return 'Connected'
    case 'missing_credentials':
      return 'Not configured'
    case 'auth_expired':
      return 'Reconnect required'
    case 'error':
      return 'Unavailable'
  }
}

function alertLabel(alert: QuotaAlert): string | null {
  if (alert === 'limit') return 'Limit reached'
  if (alert === 'critical') return '90%+ used'
  if (alert === 'warning') return '75%+ used'
  return null
}

function ProviderCard({ provider }: { provider: ProviderUsage }) {
  const hasData = provider.status === 'ok' && provider.lines.length > 0

  return (
    <article className="min-w-0 rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-[var(--theme-text)]">
            {provider.displayName}
          </h3>
          {provider.plan ? (
            <p className="text-xs text-[var(--theme-muted)]">
              {provider.plan} plan
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
            provider.status === 'ok'
              ? 'bg-emerald-500/10 text-emerald-600'
              : provider.status === 'missing_credentials'
                ? 'bg-[var(--theme-hover)] text-[var(--theme-muted)]'
                : 'bg-amber-500/10 text-amber-600'
          }`}
        >
          {providerStatus(provider.status)}
        </span>
      </div>

      {hasData ? (
        <div className="space-y-3">
          {provider.lines.map((line, index) => {
            const alert = quotaAlert(line)
            const alertText = alertLabel(alert)
            const hasProgress =
              line.type === 'progress' &&
              line.used !== undefined &&
              line.limit !== undefined &&
              line.limit > 0
            const percent = hasProgress
              ? Math.max(0, Math.min(100, (line.used! / line.limit!) * 100))
              : 0

            return (
              <div key={`${line.label}-${index}`} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                  <span className="text-[var(--theme-muted)]">
                    {line.label}
                  </span>
                  <span className="flex items-center gap-2 font-medium tabular-nums text-[var(--theme-text)]">
                    {usageValue(line)}
                    {hasProgress && line.format === 'dollars'
                      ? ` / $${line.limit!.toFixed(2)}`
                      : null}
                    {alertText ? (
                      <span
                        role="status"
                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          alert === 'limit' || alert === 'critical'
                            ? 'bg-red-500/10 text-red-600'
                            : 'bg-amber-500/10 text-amber-600'
                        }`}
                      >
                        {alertText}
                      </span>
                    ) : null}
                  </span>
                </div>
                {hasProgress ? (
                  <div
                    className="h-2 overflow-hidden rounded-full bg-[var(--theme-hover)]"
                    role="progressbar"
                    aria-label={`${provider.displayName} ${line.label}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(percent)}
                  >
                    <div
                      className={`h-full rounded-full transition-[width] ${
                        alert === 'limit' || alert === 'critical'
                          ? 'bg-red-500'
                          : alert === 'warning'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                ) : null}
                {line.resetsAt ? (
                  <p className="text-[10px] text-[var(--theme-muted)]">
                    Resets {new Date(line.resetsAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--theme-muted)]">
          {provider.message ?? 'No usage data reported by this provider.'}
        </p>
      )}
      <p className="mt-3 text-[10px] text-[var(--theme-muted)]">
        Updated {new Date(provider.updatedAt).toLocaleTimeString()}
      </p>
    </article>
  )
}

function AgentSummary({
  name,
  detail,
  note,
}: {
  name: string
  detail: string
  note: string
}) {
  return (
    <div className="rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-3">
      <div className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
        {name}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-[var(--theme-text)]">
        {detail}
      </div>
      <div className="mt-1 text-[10px] text-[var(--theme-muted)]">{note}</div>
    </div>
  )
}

export function AiUsagePanel({
  hermesUsage,
  copilotUsage,
}: {
  hermesUsage: HermesModelUsage | null
  copilotUsage: CopilotUsage | null
}) {
  const query = useQuery({
    queryKey: ['provider-usage', 'ops-cost'],
    queryFn: async () => {
      const response = await fetch('/api/provider-usage', {
        headers: { Accept: 'application/json' },
      })
      const payload = (await response
        .json()
        .catch(() => null)) as ProviderUsageResponse | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      return payload
    },
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const providers = query.data?.providers ?? []
  const codex = providers.find((provider) => provider.provider === 'codex')
  const claude = providers.find((provider) => provider.provider === 'claude')
  const lastUpdated = query.data?.updatedAt

  return (
    <section className="space-y-3 rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--theme-text)]">
            AI agent &amp; provider usage
          </h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Provider-reported limits where available; Hermes session telemetry
            is shown separately.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated ? (
            <span className="text-[10px] text-[var(--theme-muted)]">
              Snapshot {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="rounded-lg border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-text)] transition hover:bg-[var(--theme-hover)] disabled:opacity-50"
          >
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <AgentSummary
          name="Codex"
          detail={
            codex?.status === 'ok'
              ? (codex.plan ?? 'Connected')
              : providerStatus(codex?.status ?? 'missing_credentials')
          }
          note="Session and weekly limits when reported"
        />
        <AgentSummary
          name="Claude"
          detail={
            claude?.status === 'ok'
              ? (claude.plan ?? 'Connected')
              : providerStatus(claude?.status ?? 'missing_credentials')
          }
          note="Session and weekly limits when reported"
        />
        <AgentSummary
          name="Copilot"
          detail={
            copilotUsage
              ? `${copilotUsage.requests7d.toLocaleString()} usage events / 7d`
              : 'No local telemetry'
          }
          note={
            copilotUsage
              ? `${copilotUsage.requests24h.toLocaleString()} today · ${copilotUsage.sessions7d.toLocaleString()} sessions · ${(copilotUsage.inputTokens7d + copilotUsage.outputTokens7d).toLocaleString()} tokens · ${copilotUsage.aiu7d.toLocaleString()} AIU${copilotUsage.lastEventAt ? ` · last ${new Date(copilotUsage.lastEventAt).toLocaleString()}` : ''}`
              : 'Copilot CLI usage database unavailable'
          }
        />
        <AgentSummary
          name="Hermes gateway · 7d"
          detail={
            hermesUsage
              ? `${hermesUsage.sessions.toLocaleString()} sessions`
              : 'No telemetry'
          }
          note={
            hermesUsage
              ? `${hermesUsage.tokens.toLocaleString()} tokens · gateway sessions only`
              : 'Gateway session store unavailable'
          }
        />
      </div>

      {query.isError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-[var(--theme-text)]">
          Provider readings unavailable: {query.error.message}
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="ml-2 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}

      {providers.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <ProviderCard key={provider.provider} provider={provider} />
          ))}
        </div>
      ) : query.isPending ? (
        <p className="text-xs text-[var(--theme-muted)]">
          Loading connected provider readings…
        </p>
      ) : null}

      <p className="text-[10px] text-[var(--theme-muted)]">
        Copilot readings come from local CLI counters, not GitHub billing
        totals. Provider readings are separate account limits, not a combined
        budget. Missing feeds are shown as unavailable rather than estimated.
      </p>
    </section>
  )
}
