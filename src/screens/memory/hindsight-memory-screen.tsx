import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  AlertCircleIcon,
  BrainIcon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Delete01Icon,
  Loading03Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

type HindsightMemory = {
  id: string
  text: string
  context: string
  date: string
  fact_type: string
  mentioned_at: string
  occurred_start: string | null
  occurred_end: string | null
  entities: string
  chunk_id: string | null
  proof_count: number
  tags: Array<string>
  consolidated_at: string | null
  consolidation_failed_at: string | null
}

type HindsightRecallResult = {
  id: string
  text: string
  type: string
  entities: Array<string>
  context: string | null
  mentioned_at: string
  tags: Array<string>
}

type HindsightOperation = {
  id: string
  task_type: string
  items_count: number
  created_at: string
  status: string
  error_message: string | null
  retry_count: number
}

type StatusData = {
  daemon: { status: string; database: string }
  model: string
  provider: string
  dlqCount: number
  stats: {
    total_nodes?: number
    pending_operations?: number
    failed_operations?: number
    last_consolidated_at?: string
  } | null
}

type MemoriesData = {
  items: Array<HindsightMemory>
  total: number
  limit: number
  offset: number
}

type RecallData = {
  results: Array<HindsightRecallResult>
}

type OperationsData = {
  operations: Array<HindsightOperation>
  total: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function modelShort(model: string): string {
  const parts = model.split('/')
  const name = parts[parts.length - 1] ?? model
  return name.replace(':free', '').slice(0, 28)
}

function getSisterName(tags: Array<string>): string | null {
  const t = tags.find((x) => x.startsWith('sister:'))
  return t ? t.replace('sister:', '') : null
}

function factTypeBadge(type: string): string {
  if (type === 'observation')
    return 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
  if (type === 'world')
    return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
  return 'border-[var(--theme-border)] bg-[var(--theme-panel)] text-[var(--theme-muted)]'
}

function opStatusBadge(status: string): string {
  if (status === 'completed')
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'failed')
    return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

// ── Status bar ─────────────────────────────────────────────────────────────

function StatusBar({ data, isLoading }: { data: StatusData | undefined; isLoading: boolean }) {
  const healthy =
    data?.daemon.status === 'healthy' && data?.daemon.database === 'connected'

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-2 text-xs">
      {/* Daemon health */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'size-2 rounded-full',
            isLoading
              ? 'bg-[var(--theme-muted)]'
              : healthy
                ? 'bg-emerald-500'
                : 'bg-rose-500',
          )}
        />
        <span className="text-[var(--theme-muted)]">
          {isLoading ? 'Checking…' : healthy ? 'Daemon healthy' : 'Daemon offline'}
        </span>
      </div>

      {data?.model ? (
        <div className="flex items-center gap-1 text-[var(--theme-muted)]">
          <span className="opacity-40">|</span>
          <HugeiconsIcon icon={BrainIcon} className="size-3" />
          <span className="font-mono">{modelShort(data.model)}</span>
        </div>
      ) : null}

      {data?.stats?.total_nodes !== undefined ? (
        <div className="text-[var(--theme-muted)]">
          <span className="opacity-40">|</span>{' '}
          {data.stats.total_nodes} memories
        </div>
      ) : null}

      {(data?.dlqCount ?? 0) > 0 ? (
        <div className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
          <HugeiconsIcon icon={AlertCircleIcon} className="size-3" />
          DLQ: {data!.dlqCount} pending
        </div>
      ) : null}

      {(data?.stats?.pending_operations ?? 0) > 0 ? (
        <div className="flex items-center gap-1 text-[var(--theme-muted)]">
          <HugeiconsIcon icon={Loading03Icon} className="size-3 animate-spin" />
          {data!.stats!.pending_operations} op(s) running
        </div>
      ) : null}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function HindsightMemoryScreen() {
  const queryClient = useQueryClient()
  const [panel, setPanel] = useState<'memories' | 'operations'>('memories')
  const [searchInput, setSearchInput] = useState('')
  const [recallMode, setRecallMode] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addContent, setAddContent] = useState('')
  const [addContext, setAddContext] = useState('')
  const [bank, setBank] = useState<'hermes' | 'agents' | 'all'>('hermes')
  const deferredSearch = useDeferredValue(searchInput)
  const searchTerm = deferredSearch.trim()

  const primaryBank = bank === 'all' ? 'hermes' : bank

  // Status — poll every 30s; scoped to active bank for node counts
  const statusQuery = useQuery({
    queryKey: ['hindsight', 'status', primaryBank],
    queryFn: () => readJson<StatusData>(`/api/hindsight/status?bank=${primaryBank}`),
    refetchInterval: 30_000,
  })

  // Memory browse list (when not in recall mode)
  const memoriesQuery = useQuery({
    queryKey: ['hindsight', 'memories', primaryBank, searchTerm],
    queryFn: () => {
      const p = new URLSearchParams({ bank: primaryBank })
      if (searchTerm) p.set('q', searchTerm)
      return readJson<MemoriesData>(`/api/hindsight/memories?${p.toString()}`)
    },
    enabled: panel === 'memories' && !recallMode,
  })

  // Agents bank memories — only fetched when bank === 'all'
  const agentsMemoriesQuery = useQuery({
    queryKey: ['hindsight', 'memories', 'agents', searchTerm],
    queryFn: () => {
      const p = new URLSearchParams({ bank: 'agents' })
      if (searchTerm) p.set('q', searchTerm)
      return readJson<MemoriesData>(`/api/hindsight/memories?${p.toString()}`)
    },
    enabled: panel === 'memories' && !recallMode && bank === 'all',
  })

  // Operations list
  const operationsQuery = useQuery({
    queryKey: ['hindsight', 'operations'],
    queryFn: () => readJson<OperationsData>('/api/hindsight/operations?limit=30'),
    enabled: panel === 'operations',
    refetchInterval: panel === 'operations' ? 15_000 : false,
  })

  // Recall mutation
  const recallMutation = useMutation({
    mutationFn: (query: string) =>
      fetch('/api/hindsight/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, bank: primaryBank }),
      }).then((r) => r.json() as Promise<RecallData>),
    onSuccess: () => setRecallMode(true),
  })

  // Add memory mutation
  const addMutation = useMutation({
    mutationFn: ({ content, context }: { content: string; context: string }) =>
      fetch('/api/hindsight/retain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, context: context || undefined, bank: primaryBank }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setAddOpen(false)
      setAddContent('')
      setAddContext('')
      void queryClient.invalidateQueries({ queryKey: ['hindsight', 'memories'] })
      void queryClient.invalidateQueries({ queryKey: ['hindsight', 'status'] })
    },
  })

  // Delete memory mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch('/api/hindsight/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, bank: primaryBank }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['hindsight', 'memories'] })
      void queryClient.invalidateQueries({ queryKey: ['hindsight', 'status'] })
    },
  })

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && searchTerm) {
      recallMutation.mutate(searchTerm)
    }
    if (e.key === 'Escape') {
      setSearchInput('')
      setRecallMode(false)
    }
  }

  function clearRecall() {
    setRecallMode(false)
    recallMutation.reset()
  }

  const hermesItems = memoriesQuery.data?.items ?? []
  const agentItems = agentsMemoriesQuery.data?.items ?? []
  const memories =
    bank === 'all'
      ? [...hermesItems, ...agentItems].sort(
          (a, b) => new Date(b.mentioned_at).getTime() - new Date(a.mentioned_at).getTime(),
        )
      : hermesItems
  const recallResults = recallMutation.data?.results ?? []
  const operations = operationsQuery.data?.operations ?? []

  const listItems: Array<{ id: string; text: string; badge: string; sub: string; sisterTag: string | null }> =
    recallMode
      ? recallResults.map((r) => ({
          id: r.id,
          text: r.text,
          badge: r.type,
          sub: fmtDate(r.mentioned_at),
          sisterTag: getSisterName(r.tags),
        }))
      : memories.map((m) => ({
          id: m.id,
          text: m.text,
          badge: m.fact_type,
          sub: fmtDate(m.mentioned_at),
          sisterTag: getSisterName(m.tags),
        }))

  const selectedMemory =
    !recallMode && selectedId
      ? memories.find((m) => m.id === selectedId) ?? null
      : null

  const selectedRecall =
    recallMode && selectedId
      ? recallResults.find((r) => r.id === selectedId) ?? null
      : null

  const daemonOffline =
    !statusQuery.isLoading &&
    statusQuery.data?.daemon.status !== 'healthy'

  return (
    <div data-route-page className="flex h-full min-h-0 flex-col">
      <StatusBar data={statusQuery.data} isLoading={statusQuery.isLoading} />

      {daemonOffline ? (
        <div className="m-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
          Hindsight daemon is offline. Run{' '}
          <code className="rounded bg-rose-500/10 px-1 font-mono text-xs">
            hermes gateway run
          </code>{' '}
          to restart it — the memory plugin will relaunch the daemon automatically.
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Left panel */}
        <aside className="flex min-h-0 flex-col border-b border-[var(--theme-border)] bg-[var(--theme-panel)] lg:border-r lg:border-b-0">
          {/* Bank toggle */}
          <div className="flex items-center gap-1 border-b border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-2">
            {(['hermes', 'agents', 'all'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => { setBank(b); clearRecall() }}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-all',
                  bank === b
                    ? 'bg-[var(--theme-accent)] text-white'
                    : 'text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)]',
                )}
              >
                {b === 'hermes' ? 'Naveen' : b === 'agents' ? 'Agents' : 'All'}
              </button>
            ))}
            {statusQuery.data?.stats?.total_nodes !== undefined ? (
              <span className="ml-auto font-mono text-[10px] text-[var(--theme-muted)]">
                {statusQuery.data.stats.total_nodes} nodes
              </span>
            ) : null}
          </div>

          {/* Panel tabs + search */}
          <div className="space-y-3 border-b border-[var(--theme-border)] p-4">
            <div className="flex items-center gap-1 text-xs">
              {(['memories', 'operations'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPanel(p)
                    clearRecall()
                  }}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-1.5 capitalize transition',
                    panel === p
                      ? 'border-[var(--theme-accent)] bg-[var(--theme-hover)] text-[var(--theme-text)]'
                      : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]',
                  )}
                >
                  {p}
                </button>
              ))}
              {panel === 'memories' ? (
                <button
                  type="button"
                  title="Add memory"
                  onClick={() => setAddOpen(true)}
                  className="rounded-lg border border-[var(--theme-border)] p-2.5 sm:p-1.5 touch-manipulation text-[var(--theme-muted)] transition hover:bg-[var(--theme-hover)]"
                >
                  <HugeiconsIcon icon={Add01Icon} className="size-3.5" />
                </button>
              ) : null}
            </div>

            {/* Add memory form */}
            {addOpen ? (
              <div className="space-y-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--theme-muted)]">
                    Add memory
                  </span>
                  <button
                    type="button"
                    onClick={() => { setAddOpen(false); setAddContent(''); setAddContext('') }}
                    className="text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={addContent}
                  onChange={(e) => setAddContent(e.target.value)}
                  placeholder="Memory content…"
                  className="w-full resize-none rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
                />
                <input
                  value={addContext}
                  onChange={(e) => setAddContext(e.target.value)}
                  placeholder="Context (optional)"
                  className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-sm text-[var(--theme-text)] outline-none"
                />
                <button
                  type="button"
                  disabled={!addContent.trim() || addMutation.isPending}
                  onClick={() => addMutation.mutate({ content: addContent, context: addContext })}
                  className="w-full rounded-lg border border-[var(--theme-accent)] bg-[var(--theme-accent)]/20 py-1.5 text-xs font-medium text-[var(--theme-text)] transition hover:bg-[var(--theme-accent)]/30 disabled:opacity-50"
                >
                  {addMutation.isPending ? 'Saving…' : 'Save to Hindsight'}
                </button>
                {addMutation.isError ? (
                  <p className="text-xs text-rose-600">{String(addMutation.error)}</p>
                ) : null}
              </div>
            ) : null}

            {panel === 'memories' ? (
              <div className="relative">
                <HugeiconsIcon
                  icon={Search01Icon}
                  className="pointer-events-none absolute top-2.5 left-3 size-4 text-[var(--theme-muted)]"
                />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search or Enter to recall…"
                  className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] py-2 pr-3 pl-9 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
                />
              </div>
            ) : null}

            {recallMode ? (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--theme-muted)]">
                  Recall: {recallResults.length} result(s)
                </span>
                <button
                  type="button"
                  onClick={clearRecall}
                  className="text-[var(--theme-muted)] underline hover:text-[var(--theme-text)]"
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {panel === 'memories' ? (
              <>
                {memoriesQuery.isLoading || recallMutation.isPending ? (
                  <p className="p-3 text-sm text-[var(--theme-muted)]">Loading…</p>
                ) : null}
                {memoriesQuery.error ? (
                  <p className="p-3 text-sm text-rose-600">
                    {memoriesQuery.error instanceof Error
                      ? memoriesQuery.error.message
                      : 'Failed to load memories'}
                  </p>
                ) : null}
                {!memoriesQuery.isLoading && !recallMutation.isPending && listItems.length === 0 ? (
                  <p className="p-3 text-sm text-[var(--theme-muted)]">
                    No memories found.
                  </p>
                ) : null}
                <div className="space-y-2">
                  {listItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        'w-full rounded-xl border p-3 text-left transition',
                        selectedId === item.id
                          ? 'border-[var(--theme-accent)] bg-[var(--theme-hover)]'
                          : 'border-[var(--theme-border)] bg-[var(--theme-card)] hover:bg-[var(--theme-hover)]',
                      )}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[10px] capitalize',
                              factTypeBadge(item.badge),
                            )}
                          >
                            {item.badge}
                          </span>
                          {item.sisterTag ? (
                            <span className="rounded-full border border-[var(--theme-accent)]/40 bg-[var(--theme-accent)]/10 px-2 py-0.5 text-[10px] capitalize text-[var(--theme-accent)]">
                              {item.sisterTag}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-[10px] text-[var(--theme-muted)]">
                          {item.sub}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-sm text-[var(--theme-text)]">
                        {item.text}
                      </p>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {operationsQuery.isLoading ? (
                  <p className="p-3 text-sm text-[var(--theme-muted)]">Loading…</p>
                ) : null}
                {operationsQuery.error ? (
                  <p className="p-3 text-sm text-rose-600">
                    {operationsQuery.error instanceof Error
                      ? operationsQuery.error.message
                      : 'Failed to load operations'}
                  </p>
                ) : null}
                <div className="space-y-2">
                  {operations.map((op) => (
                    <div
                      key={op.id}
                      className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-[var(--theme-muted)] capitalize">
                          {op.task_type.replace(/_/g, ' ')}
                        </span>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] capitalize',
                            opStatusBadge(op.status),
                          )}
                        >
                          {op.status}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--theme-muted)]">
                        {fmtDate(op.created_at)}
                        {op.items_count > 0 ? ` · ${op.items_count} item(s)` : ''}
                        {op.retry_count > 0 ? ` · retried ${op.retry_count}×` : ''}
                      </p>
                      {op.error_message ? (
                        <p className="mt-1 text-xs text-rose-600 dark:text-rose-400 line-clamp-2">
                          {op.error_message}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {!operationsQuery.isLoading && operations.length === 0 ? (
                    <p className="p-3 text-sm text-[var(--theme-muted)]">
                      No operations yet.
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Detail panel */}
        <main className="min-h-0 overflow-y-auto bg-[var(--theme-panel)] p-4">
          {selectedMemory ? (
            <MemoryDetail
              memory={selectedMemory}
              onDelete={() => {
                if (window.confirm('Delete this memory? This removes all its observations from Hindsight.')) {
                  deleteMutation.mutate(selectedMemory.id)
                }
              }}
              isDeleting={deleteMutation.isPending}
            />
          ) : selectedRecall ? (
            <RecallDetail result={selectedRecall} />
          ) : (
            <EmptyDetail />
          )}
        </main>
      </div>
    </div>
  )
}

// ── Detail components ──────────────────────────────────────────────────────

function MemoryDetail({
  memory,
  onDelete,
  isDeleting,
}: {
  memory: HindsightMemory
  onDelete: () => void
  isDeleting: boolean
}) {
  return (
    <article className="mx-auto max-w-4xl space-y-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--theme-border)] pb-4">
        <div>
          <p className="font-mono text-xs text-[var(--theme-muted)]">{memory.id}</p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-xs capitalize',
                factTypeBadge(memory.fact_type),
              )}
            >
              {memory.fact_type}
            </span>
            {memory.consolidated_at ? (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-3" />
                consolidated
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-[var(--theme-muted)]">
            <HugeiconsIcon icon={Clock01Icon} className="size-3" />
            {fmtDate(memory.mentioned_at)}
          </div>
          <button
            type="button"
            title="Delete memory"
            disabled={isDeleting}
            onClick={onDelete}
            className="rounded-lg border border-rose-300 p-2.5 sm:p-1.5 touch-manipulation text-rose-500 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-900/20"
          >
            <HugeiconsIcon icon={Delete01Icon} className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 text-sm leading-7 whitespace-pre-wrap text-[var(--theme-text)]">
        {memory.text}
      </div>

      <dl className="grid gap-3 text-sm md:grid-cols-2">
        {memory.entities ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
              Entities
            </dt>
            <dd className="mt-1 text-[var(--theme-text)]">{memory.entities}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
            Proof count
          </dt>
          <dd className="mt-1 text-[var(--theme-text)]">{memory.proof_count}</dd>
        </div>
        {memory.tags.length > 0 ? (
          <div className="md:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
              Tags
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {memory.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-xs text-[var(--theme-muted)]"
                >
                  {tag}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        {memory.context ? (
          <div className="md:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-[var(--theme-muted)]">
              Context
            </dt>
            <dd className="mt-1 text-xs text-[var(--theme-muted)] whitespace-pre-wrap">
              {memory.context}
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  )
}

function RecallDetail({ result }: { result: HindsightRecallResult }) {
  return (
    <article className="mx-auto max-w-4xl space-y-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
      <div className="flex items-center gap-2 border-b border-[var(--theme-border)] pb-4">
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs capitalize',
            factTypeBadge(result.type),
          )}
        >
          {result.type}
        </span>
        <span className="text-xs text-[var(--theme-muted)]">
          {fmtDate(result.mentioned_at)}
        </span>
      </div>

      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 text-sm leading-7 whitespace-pre-wrap text-[var(--theme-text)]">
        {result.text}
      </div>

      {result.entities.length > 0 ? (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-[var(--theme-muted)]">
            Entities
          </p>
          <div className="flex flex-wrap gap-1">
            {result.entities.map((e) => (
              <span
                key={e}
                className="rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-xs text-[var(--theme-muted)]"
              >
                {e}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <HugeiconsIcon
          icon={BrainIcon}
          className="mx-auto mb-3 size-8 text-[var(--theme-muted)]"
        />
        <p className="text-sm text-[var(--theme-muted)]">
          Select a memory to inspect, or press <kbd className="rounded border border-[var(--theme-border)] px-1 font-mono text-xs">Enter</kbd> in the search box to recall.
        </p>
      </div>
    </div>
  )
}
