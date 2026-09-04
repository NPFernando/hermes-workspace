import { HugeiconsIcon } from '@hugeicons/react'
import { BrainIcon, Search01Icon } from '@hugeicons/core-free-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { readJson } from '@/lib/memory-screen-utils'
import { cn } from '@/lib/utils'
import { safeErrorMessage } from '@/lib/error-utils'

type ExternalMemoryProvider = {
  id: string
  label: string
  kind?: string
  capabilities: Array<string>
  dbPath: string
  configPath: string
  available: boolean
}

type MemoryState = 'candidate' | 'approved' | 'rejected' | 'all'

type StateCounts = Partial<Record<MemoryState, number>>

const MEMORY_STATES: ReadonlyArray<MemoryState> = [
  'candidate',
  'approved',
  'rejected',
  'all',
]

type ExternalMemoryCandidate = {
  provider: string
  id: string
  text: string
  source: string
  metadata: Record<string, unknown>
  state: string
  contentSha256: string
  createdAt: number
  updatedAt: number
}

type ProviderResponse = {
  active: string
  providers: Array<ExternalMemoryProvider>
}

type CandidateResponse = {
  provider: string
  state: string
  count: number
  total: number
  counts?: StateCounts
  candidates?: Array<ExternalMemoryCandidate>
}

type SearchResponse = {
  provider: string
  query: string
  count: number
  results?: Array<ExternalMemoryCandidate>
}

type CandidateAction = 'edit' | 'approve' | 'reject' | 'delete'

async function mutateCandidate(options: {
  action: CandidateAction
  provider: string
  id: string
  text?: string
  reason?: string
}): Promise<{ hindsight_operation_id?: string }> {
  const response =
    options.action === 'delete'
      ? await fetch(
          `/api/external-memory/candidates?provider=${encodeURIComponent(options.provider)}&id=${encodeURIComponent(options.id)}`,
          { method: 'DELETE' },
        )
      : await fetch('/api/external-memory/candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options),
        })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || `Action failed (${response.status})`)
  }
  return response.json().catch(() => ({})) as Promise<{
    hindsight_operation_id?: string
  }>
}

function formatTimestamp(value: number): string {
  if (!value) return 'Unknown'
  const millis = value < 10_000_000_000 ? value * 1000 : value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(millis))
}

function stateClasses(state: string): string {
  if (state === 'approved')
    return 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)] dark:text-[var(--theme-success)]'
  if (state === 'rejected')
    return 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)] dark:text-[var(--theme-danger)]'
  return 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)] dark:text-[var(--theme-warning)]'
}

function metadataPreview(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata).slice(0, 4)
  if (entries.length === 0) return 'No metadata'
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
}

export function formatStateFilterLabel(
  state: MemoryState,
  counts: StateCounts,
): string {
  const count = counts[state]
  return typeof count === 'number' ? `${state} (${count})` : state
}

export function candidateActionLabels(
  candidate: Pick<ExternalMemoryCandidate, 'state'>,
  providerKind?: string,
): Array<string> {
  const labels = ['Edit']
  if (candidate.state !== 'approved')
    labels.push(providerKind === 'hindsight' ? 'Approve & Retain' : 'Approve')
  if (candidate.state !== 'rejected') labels.push('Reject')
  labels.push('Delete')
  return labels
}

async function readStateCounts(providerId: string): Promise<StateCounts> {
  const entries = await Promise.all(
    MEMORY_STATES.map(async (state) => {
      const response = await readJson<CandidateResponse>(
        `/api/external-memory/candidates?provider=${encodeURIComponent(providerId)}&state=${encodeURIComponent(state)}&limit=1`,
      )
      return [state, response.total] as const
    }),
  )
  return Object.fromEntries(entries) as StateCounts
}

export function ExternalMemoryBrowserScreen() {
  const queryClient = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [state, setState] = useState<MemoryState>('candidate')
  const [searchInput, setSearchInput] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastRetainOpId, setLastRetainOpId] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(searchInput)
  const searchTerm = deferredSearch.trim()

  const providersQuery = useQuery({
    queryKey: ['external-memory', 'providers'],
    queryFn: () => readJson<ProviderResponse>('/api/external-memory/providers'),
  })

  const providers = providersQuery.data?.providers ?? []
  useEffect(() => {
    if (providerId || providers.length === 0) return
    setProviderId(providersQuery.data?.active || providers[0]?.id || '')
  }, [providerId, providers, providersQuery.data?.active])

  const listQuery = useQuery({
    queryKey: ['external-memory', 'candidates', providerId, state],
    queryFn: () =>
      readJson<CandidateResponse>(
        `/api/external-memory/candidates?provider=${encodeURIComponent(providerId)}&state=${encodeURIComponent(state)}`,
      ),
    enabled: Boolean(providerId) && !searchTerm,
  })

  const countsQuery = useQuery({
    queryKey: ['external-memory', 'candidate-counts', providerId],
    queryFn: () => readStateCounts(providerId),
    enabled: Boolean(providerId) && !searchTerm,
  })

  const searchQuery = useQuery({
    queryKey: ['external-memory', 'search', providerId, searchTerm],
    queryFn: () =>
      readJson<SearchResponse>(
        `/api/external-memory/search?provider=${encodeURIComponent(providerId)}&q=${encodeURIComponent(searchTerm)}`,
      ),
    enabled: Boolean(providerId) && Boolean(searchTerm),
  })

  const candidates = searchTerm
    ? (searchQuery.data?.results ?? [])
    : (listQuery.data?.candidates ?? [])
  const stateCounts = listQuery.data?.counts ?? countsQuery.data ?? {}

  useEffect(() => {
    if (
      selectedId &&
      candidates.some((candidate) => candidate.id === selectedId)
    )
      return
    setSelectedId(candidates[0]?.id ?? null)
  }, [candidates, selectedId])

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedId) ?? null,
    [candidates, selectedId],
  )
  const activeProvider =
    providers.find((provider) => provider.id === providerId) ?? null
  const isLoading =
    providersQuery.isLoading || listQuery.isLoading || searchQuery.isLoading
  const error = providersQuery.error || listQuery.error || searchQuery.error

  async function refreshCandidates() {
    await queryClient.invalidateQueries({ queryKey: ['external-memory'] })
  }

  async function runAction(action: CandidateAction) {
    if (!selected) return
    let text: string | undefined
    let reason: string | undefined
    if (action === 'edit') {
      text = window.prompt('Edit memory candidate', selected.text) || ''
      if (!text.trim() || text === selected.text) return
    }
    if (action === 'reject') {
      reason = window.prompt('Reason for rejection', '') || ''
    }
    if (
      action === 'delete' &&
      !window.confirm('Delete this external memory row?')
    ) {
      return
    }
    setLastRetainOpId(null)
    const result = await mutateCandidate({
      action,
      provider: selected.provider,
      id: selected.id,
      text,
      reason,
    })
    if (action === 'approve' && result.hindsight_operation_id) {
      setLastRetainOpId(result.hindsight_operation_id)
    }
    if (action === 'delete') setSelectedId(null)
    await refreshCandidates()
  }

  if (!providersQuery.isLoading && providers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="max-w-xl rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-6">
          <HugeiconsIcon
            icon={BrainIcon}
            className="mx-auto mb-4 size-8 text-[var(--theme-muted)]"
          />
          <h2 className="text-center text-lg font-semibold text-[var(--theme-text)]">
            No external memory providers
          </h2>
          <p className="mt-2 text-center text-sm text-[var(--theme-muted)]">
            This tab shows a human review queue for memories the agent has
            flagged before committing them to long-term storage.
          </p>
          <div className="mt-4 space-y-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <p className="text-xs font-medium text-[var(--theme-muted)]">
              To enable: create{' '}
              <code className="rounded bg-[var(--theme-hover)] px-1 font-mono">
                ~/.hermes/external_memory_providers.json
              </code>
            </p>
            <pre className="overflow-x-auto rounded-lg bg-[var(--theme-panel)] p-3 text-xs text-[var(--theme-text)]">{`{
  "providers": [{
    "id": "hindsight",
    "label": "Hindsight (Long-term Memory)",
    "db_path": "external_memory/hindsight_candidates.sqlite",
    "config_path": "hindsight/config.json"
  }]
}`}</pre>
            <p className="text-xs text-[var(--theme-muted)]">
              Memories written by Astra during sessions will appear here as
              candidates for you to approve, reject, or edit before they enter
              long-term recall.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      data-route-page
      className="grid h-full min-h-0 grid-cols-1 gap-0 lg:grid-cols-[380px_minmax(0,1fr)]"
    >
      <aside className="flex min-h-0 flex-col border-b border-[var(--theme-border)] bg-[var(--theme-bg)] lg:border-r lg:border-b-0">
        <div className="space-y-3 border-b border-[var(--theme-border)] p-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--theme-text)]">
              External memory
            </h2>
            <p className="text-xs text-[var(--theme-muted)]">
              Review queues backed by custom providers.
            </p>
          </div>

          <select
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-input)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>

          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute top-2.5 left-3 size-4 text-[var(--theme-muted)]"
            />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search text, metadata, source..."
              className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-input)] py-2 pr-3 pl-9 text-sm text-[var(--theme-text)] outline-none"
            />
          </div>

          <div className="grid grid-cols-4 gap-1 text-xs">
            {MEMORY_STATES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setState(item)}
                disabled={Boolean(searchTerm)}
                className={cn(
                  'rounded-lg border px-2 py-1.5 capitalize transition disabled:opacity-40',
                  state === item
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-hover)] text-[var(--theme-text)] dark:border-blue-500 dark:bg-blue-500/15 dark:text-blue-100'
                    : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-panel)]',
                )}
              >
                {formatStateFilterLabel(item, stateCounts)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <p className="p-3 text-sm text-[var(--theme-muted)]">Loading...</p>
          ) : null}
          {error ? (
            <p className="p-3 text-sm text-[var(--theme-danger)]">
              {safeErrorMessage(error)}
            </p>
          ) : null}
          {!isLoading && candidates.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-[var(--theme-muted)]">
                No {state === 'all' ? '' : state + ' '}candidates yet.
              </p>
              {state === 'candidate' ? (
                <p className="mt-1 text-xs text-[var(--theme-muted)]">
                  Memory candidates appear here as Astra saves notes during
                  sessions.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setSelectedId(candidate.id)}
                className={cn(
                  'w-full rounded-xl border p-3 text-left transition',
                  selectedId === candidate.id
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-panel)] dark:border-blue-500 dark:bg-blue-500/10'
                    : 'border-[var(--theme-border)] bg-[var(--theme-bg)] hover:bg-[var(--theme-card)]',
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-[var(--theme-muted)]">
                    {candidate.id}
                  </span>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] capitalize',
                      stateClasses(candidate.state),
                    )}
                  >
                    {candidate.state}
                  </span>
                </div>
                <p className="line-clamp-3 text-sm text-[var(--theme-text)]">
                  {candidate.text}
                </p>
                <p className="mt-2 text-xs text-[var(--theme-muted)]">
                  {formatTimestamp(candidate.updatedAt)}
                </p>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto bg-[var(--theme-bg)] p-4">
        {selected ? (
          <article className="mx-auto max-w-4xl space-y-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--theme-border)] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs text-[var(--theme-muted)]">
                    {selected.id}
                  </p>
                  {activeProvider?.kind === 'hindsight' ? (
                    <span className="rounded-full border border-[color-mix(in_srgb,var(--theme-accent-secondary)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent-secondary)_10%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-accent-secondary)] dark:text-[var(--theme-accent-secondary)]">
                      Hindsight
                    </span>
                  ) : null}
                </div>
                <h1 className="mt-1 text-xl font-semibold text-[var(--theme-text)]">
                  {activeProvider?.label || selected.provider}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs capitalize',
                    stateClasses(selected.state),
                  )}
                >
                  {selected.state}
                </span>
                {candidateActionLabels(selected, activeProvider?.kind).map(
                  (label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        runAction(
                          (label.startsWith('Approve')
                            ? 'approve'
                            : label.toLowerCase()) as CandidateAction,
                        )
                      }
                      className={cn(
                        'rounded-lg border px-3 py-1 text-xs transition',
                        label === 'Delete'
                          ? 'border-[color-mix(in_srgb,var(--theme-danger)_40%,transparent)] text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] dark:text-[var(--theme-danger)]'
                          : label.startsWith('Approve')
                            ? 'border-[color-mix(in_srgb,var(--theme-accent-secondary)_40%,transparent)] text-[var(--theme-accent-secondary)] hover:bg-[color-mix(in_srgb,var(--theme-accent-secondary)_10%,transparent)] dark:border-[var(--theme-accent-secondary)] dark:text-[var(--theme-accent-secondary)] dark:hover:bg-[color-mix(in_srgb,var(--theme-accent-secondary)_10%,transparent)]'
                            : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-panel)]',
                      )}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </div>
            {lastRetainOpId ? (
              <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent-secondary)_10%,transparent)] px-4 py-3 text-xs text-[var(--theme-accent-secondary)] dark:text-[var(--theme-accent-secondary)]">
                <span className="font-medium">Committed to Hindsight.</span>
                <span className="font-mono text-[var(--theme-accent-secondary)] dark:text-[var(--theme-accent-secondary)]">
                  op:{lastRetainOpId.slice(0, 16)}…
                </span>
              </div>
            ) : null}

            <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-sm leading-7 whitespace-pre-wrap text-[var(--theme-text)]">
              {selected.text}
            </div>

            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                  Source
                </dt>
                <dd className="mt-1 text-[var(--theme-text)]">
                  {selected.source}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                  Updated
                </dt>
                <dd className="mt-1 text-[var(--theme-text)]">
                  {formatTimestamp(selected.updatedAt)}
                </dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                  Metadata
                </dt>
                <dd className="mt-1 text-[var(--theme-text)]">
                  {metadataPreview(selected.metadata)}
                </dd>
              </div>
              {selected.metadata.hindsight_operation_id ? (
                <div className="md:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-[var(--theme-accent-secondary)] dark:text-[var(--theme-accent-secondary)]">
                    Hindsight operation
                  </dt>
                  <dd className="mt-1 font-mono text-xs text-[var(--theme-accent-secondary)] dark:text-[var(--theme-accent-secondary)]">
                    {String(selected.metadata.hindsight_operation_id)}
                  </dd>
                </div>
              ) : null}
              <div className="md:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
                  SHA-256
                </dt>
                <dd className="mt-1 break-all font-mono text-xs text-[var(--theme-muted)]">
                  {selected.contentSha256}
                </dd>
              </div>
            </dl>
          </article>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--theme-muted)]">
            Select a memory row.
          </div>
        )}
      </main>
    </div>
  )
}
