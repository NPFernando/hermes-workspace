import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { McpServerCard } from './components/mcp-server-card'
import { McpServerDialog } from './components/mcp-server-dialog'
import { InstallConfirmationDialog } from './components/install-confirmation-dialog'
import { useMcpCapabilityMode } from './hooks/use-mcp-capability-mode'
import { useMcpServers } from './hooks/use-mcp-servers'
import { useMcpHub } from './hooks/use-mcp-hub'
import { SourcesManagerDialog } from './components/sources-manager-dialog'
import type { HubMcpEntry } from './hooks/use-mcp-hub'
import type { McpClientInput, McpServer } from '@/types/mcp'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'

type Tab = 'installed' | 'marketplace'

const TOOLBAR_FIELD =
  'h-9 w-full min-w-0 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-3 text-sm text-ink outline-none transition-colors focus:border-[var(--theme-accent)] sm:min-w-[220px]'

export function McpScreen() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('installed')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | McpClientInput | null>(
    null,
  )
  const [installEntry, setInstallEntry] = useState<HubMcpEntry | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const { mode: capabilityMode } = useMcpCapabilityMode()
  // Marketplace tab uses useMcpHub instead; coerce to 'installed' so the
  // server-list query stays valid but its results aren't rendered there.
  const serverListTab = tab === 'marketplace' ? 'installed' : tab
  const query = useMcpServers({ tab: serverListTab, category, search })
  const servers = query.data?.servers ?? []
  const categories = query.data?.categories ?? ['All']

  const hubQuery = useMcpHub(tab === 'marketplace' ? search : '')

  function handleTabChange(next: string | number | null) {
    if (next === 'installed' || next === 'marketplace') {
      setTab(next)
      setSearch('')
    }
  }

  const totalLabel =
    tab === 'marketplace'
      ? `${(hubQuery.data?.total ?? 0).toLocaleString()} results`
      : `${servers.length.toLocaleString()} servers`

  return (
    <div data-route-page className="min-h-full overflow-y-auto bg-surface text-ink">
      <div className="flex w-full flex-col gap-5 px-4 py-6 pb-[calc(var(--tabbar-h,80px)+1.5rem)] sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/85 p-4 backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase text-[var(--theme-muted)] tabular-nums">
                Hermes Workspace · MCP
              </p>
              <h1 className="text-2xl font-medium text-ink text-balance sm:text-3xl">
                MCP Servers
              </h1>
              <p className="text-sm text-[var(--theme-muted)] text-pretty sm:text-base">
                Discover, install, and manage Model Context Protocol servers
                exposed to Hermes Agent.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              Add Server
            </Button>
          </div>
          {capabilityMode === 'fallback' ? (
            <div
              role="status"
              className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            >
              ⚠ Local fallback mode — using config.yaml. Test, Discover, and
              Logs require the new hermes-agent /api/mcp endpoints.
            </div>
          ) : null}
        </header>

        <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3 backdrop-blur-xl sm:p-4">
          <Tabs value={tab} onValueChange={handleTabChange}>
            <div className="flex flex-wrap items-center gap-2">
              <TabsList
                className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-hover)] p-1"
                variant="default"
              >
                <TabsTab value="installed" className="min-w-[110px]">
                  Installed
                </TabsTab>
                <TabsTab value="marketplace" className="min-w-[120px]">
                  Marketplace
                </TabsTab>
              </TabsList>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  tab === 'marketplace'
                    ? 'Search MCP catalog…'
                    : 'Search servers by name'
                }
                className={`${TOOLBAR_FIELD} flex-1`}
              />

              {tab === 'installed' ? (
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-9 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-3 text-sm text-ink outline-none"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <TabsPanel value="installed" className="pt-3">
              <ServerList
                query={query}
                onEdit={(s) => {
                  setEditing(s)
                  setDialogOpen(true)
                }}
              />
            </TabsPanel>
            <TabsPanel value="marketplace" className="pt-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                {hubQuery.data?.source ? (
                  <div className="text-xs text-[var(--theme-muted)]">
                    Source: {hubQuery.data.source}
                  </div>
                ) : (
                  <div />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSourcesOpen(true)}
                >
                  Sources
                </Button>
              </div>

              {hubQuery.data?.warnings && hubQuery.data.warnings.length > 0 ? (
                hubQuery.data.results && hubQuery.data.results.length > 0 ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    ⚠ One or more sources unavailable; showing local results.
                    <span className="ml-1 text-[11px] text-[var(--theme-muted)]">
                      ({hubQuery.data.warnings[0]})
                    </span>
                  </p>
                ) : (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    {hubQuery.data.warnings[0]}
                  </div>
                )
              ) : null}

              {hubQuery.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                  {hubQuery.error instanceof Error
                    ? hubQuery.error.message
                    : 'Failed to load marketplace.'}
                </div>
              ) : null}

              <MarketplaceGrid
                entries={(hubQuery.data?.results ?? []).filter(
                  (e) => !e.installed,
                )}
                loading={hubQuery.isPending}
                onInstall={setInstallEntry}
              />

              {hubQuery.hasNextPage ? (
                <div className="flex items-center justify-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={hubQuery.isFetchingNextPage}
                    onClick={() => hubQuery.fetchNextPage()}
                  >
                    {hubQuery.isFetchingNextPage
                      ? 'Loading…'
                      : `Load more (${(hubQuery.data?.results.length ?? 0).toLocaleString()} of ${(hubQuery.data?.total ?? 0).toLocaleString()})`}
                  </Button>
                </div>
              ) : null}
            </TabsPanel>
          </Tabs>
        </section>

        <footer className="flex items-center justify-between rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2.5 text-sm text-[var(--theme-muted)] tabular-nums">
          <span>{totalLabel}</span>
          <span className="text-xs">
            mode: {capabilityMode === 'fallback' ? 'config fallback' : 'native'}
          </span>
        </footer>
      </div>

      <McpServerDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
      />

      <InstallConfirmationDialog
        entry={installEntry}
        onClose={() => setInstallEntry(null)}
        onInstalled={() => {
          queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] })
          queryClient.invalidateQueries({ queryKey: ['mcp', 'hub-search'] })
        }}
      />

      <SourcesManagerDialog
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
      />
    </div>
  )
}

interface ServerListProps {
  query: ReturnType<typeof useMcpServers>
  onEdit: (server: McpServer) => void
}

function ServerList({ query, onEdit }: ServerListProps) {
  const servers = query.data?.servers ?? []
  if (query.isLoading) {
    return (
      <EmptyCard
        title="Loading servers…"
        description="Fetching MCP servers from Hermes Agent."
      />
    )
  }
  if (query.isError) {
    return (
      <EmptyCard
        title="Failed to load servers"
        description={query.error.message}
        tone="danger"
      />
    )
  }
  if (servers.length === 0) {
    return (
      <EmptyCard
        title="No MCP servers configured"
        description="Add a server from the My Presets tab or click Add Server above."
      />
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {servers.map((server) => (
        <McpServerCard key={server.id} server={server} onEdit={onEdit} />
      ))}
    </div>
  )
}

interface EmptyCardProps {
  title: string
  description?: string
  tone?: 'neutral' | 'danger'
}

function EmptyCard({ title, description, tone = 'neutral' }: EmptyCardProps) {
  const toneClasses =
    tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200'
      : 'border-[var(--theme-border)] bg-[var(--theme-panel)] text-[var(--theme-muted)]'
  return (
    <div
      className={`rounded-xl border border-dashed px-4 py-10 text-center ${toneClasses}`}
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-[var(--theme-muted)]">{description}</p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MarketplaceGrid — Phase 3.0 Marketplace tab
// ---------------------------------------------------------------------------

const TRUST_PILL: Record<string, { label: string; className: string }> = {
  official: {
    label: 'Official',
    className:
      'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300',
  },
  community: {
    label: 'Community',
    className:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  unverified: {
    label: 'Unverified',
    className:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  },
}

const SOURCE_LABEL: Record<string, string> = {
  'mcp-get': 'mcp.run',
  local: 'Local',
}

interface MarketplaceGridProps {
  entries: Array<HubMcpEntry>
  loading: boolean
  onInstall: (entry: HubMcpEntry) => void
}

function MarketplaceGrid({
  entries,
  loading,
  onInstall,
}: MarketplaceGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer rounded-2xl border border-[var(--theme-border)] p-4 min-h-[160px]"
          >
            <div className="mb-3 h-4 w-2/5 rounded-md bg-[var(--theme-hover)]" />
            <div className="mb-2 h-3 w-3/4 rounded-md bg-[var(--theme-hover)]" />
            <div className="h-3 w-1/2 rounded-md bg-[var(--theme-hover)]" />
            <div className="mt-4 h-8 w-1/3 rounded-md bg-[var(--theme-hover)]" />
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <EmptyCard
        title="No results"
        description="Try a different search term. The registry may be unavailable — local presets are used as fallback."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <AnimatePresence initial={false}>
        {entries.map((entry) => {
          const trust = TRUST_PILL[entry.trust] ?? TRUST_PILL.unverified
          const sourceLabel = SOURCE_LABEL[entry.source] ?? entry.source

          return (
            <motion.article
              key={entry.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/85 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-base font-medium text-ink text-balance line-clamp-1">
                      {entry.name}
                    </h3>
                    {entry.installed ? (
                      <span
                        className="shrink-0 rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                        aria-label="Installed"
                      >
                        Installed
                      </span>
                    ) : null}
                  </div>
                  <p className="line-clamp-2 text-xs text-[var(--theme-muted)] text-pretty">
                    {entry.description || 'No description.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${trust.className}`}
                >
                  {trust.label}
                </span>
                <span className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--theme-muted)]">
                  {sourceLabel}
                </span>
                {entry.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-hover)]/50 px-2 py-0.5 text-[11px] text-[var(--theme-muted)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-auto flex items-center justify-end gap-2 pt-2">
                {entry.installed ? (
                  <span className="text-xs text-[var(--theme-muted)]">
                    Already installed
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onInstall(entry)}
                  >
                    Install
                  </Button>
                )}
              </div>
            </motion.article>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
