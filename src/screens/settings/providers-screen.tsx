import { Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ProviderWizard } from './components/provider-wizard'
import { SettingCard } from './providers/setting-card'
import { ActiveModelCard } from './providers/model-config-section'
import { ProviderManagementSection } from './providers/provider-management-section'
import { ResetEnvironmentSection } from './providers/reset-environment-section'
import {
  SETTINGS,
  buildModelOptions,
  buildProviderSummaries,
  fetchModels,
  searchMatchesSetting,
} from './providers/utils'
import { TAB_ORDER } from './providers/types'
import type { ProviderSummaryForEdit } from './components/provider-wizard'
import type {
  ConfigPatchResponse,
  ConfigQueryResponse,
  ProviderSummary,
  ProvidersScreenProps,
  SaveSettingPayload,
  SettingDefinition,
  SettingsTabId,
} from './providers/types'
import BackendUnavailableState from '@/components/backend-unavailable-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { getUnavailableReason } from '@/lib/feature-gates'
import { useFeatureAvailable } from '@/hooks/use-feature-available'
import { cn } from '@/lib/utils'

export function ProvidersScreen({ embedded = false }: ProvidersScreenProps) {
  const queryClient = useQueryClient()
  const configAvailable = useFeatureAvailable('config')
  const [activeTab, setActiveTab] = useState<SettingsTabId>('providers')
  const [search, setSearch] = useState('')
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editingProvider, setEditingProvider] =
    useState<ProviderSummaryForEdit | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const modelsQuery = useQuery({
    queryKey: ['claude', 'providers', 'models'],
    queryFn: fetchModels,
    refetchInterval: 60_000,
    retry: false,
    enabled: configAvailable,
  })

  const configQuery = useQuery({
    queryKey: ['claude', 'config'],
    queryFn: async () => {
      const response = await fetch('/api/config-get')
      const payload = (await response
        .json()
        .catch(() => ({}))) as ConfigQueryResponse
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`)
      }
      return payload.payload ?? {}
    },
    retry: 1,
    enabled: configAvailable,
  })

  const saveMutation = useMutation({
    mutationFn: async ({ path, value }: SaveSettingPayload) => {
      const response = await fetch('/api/config-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, value }),
      })
      const payload = (await response
        .json()
        .catch(() => ({}))) as ConfigPatchResponse
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`)
      }
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['claude', 'config'] })
      toast(`${variables.label} saved`, { type: 'success' })
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Failed to save setting', {
        type: 'error',
      })
    },
  })

  const providerSummaries = useMemo(
    function resolveProviderSummaries() {
      return buildProviderSummaries({
        models: Array.isArray(modelsQuery.data?.models)
          ? modelsQuery.data.models
          : [],
        configuredProviders: Array.isArray(
          modelsQuery.data?.configuredProviders,
        )
          ? modelsQuery.data.configuredProviders
          : [],
      })
    },
    [modelsQuery.data?.configuredProviders, modelsQuery.data?.models],
  )

  const modelOptions = useMemo(
    function resolveModelOptions() {
      return buildModelOptions(
        Array.isArray(modelsQuery.data?.models) ? modelsQuery.data.models : [],
      )
    },
    [modelsQuery.data?.models],
  )

  const searchQuery = search.trim().toLowerCase()

  const filteredSettings = useMemo(
    function filterSettings() {
      if (!searchQuery) return SETTINGS
      return SETTINGS.filter((setting) =>
        searchMatchesSetting(setting, searchQuery),
      )
    },
    [searchQuery],
  )

  const settingsByTab = useMemo(
    function groupSettingsByTab() {
      return TAB_ORDER.reduce<Record<SettingsTabId, Array<SettingDefinition>>>(
        (accumulator, tab) => {
          accumulator[tab.id] = filteredSettings.filter(
            (setting) => setting.tab === tab.id,
          )
          return accumulator
        },
        {
          providers: [],
          models: [],
          agents: [],
          session: [],
          memory: [],
        },
      )
    },
    [filteredSettings],
  )

  function handleEdit(provider: ProviderSummary) {
    setEditingProvider({ id: provider.id, name: provider.name })
    setWizardOpen(true)
  }

  async function handleDelete(provider: ProviderSummary) {
    const confirmed = window.confirm(
      `Remove provider "${provider.name}"? This will delete the API key from your local config.`,
    )
    if (!confirmed) return

    setDeletingId(provider.id)
    try {
      const res = await fetch('/api/claude-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'remove-provider',
          provider: provider.id,
        }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) {
        toast(`Failed to remove provider: ${data.error ?? 'Unknown error'}`, {
          type: 'error',
        })
      } else {
        await queryClient.invalidateQueries({
          queryKey: ['claude', 'providers', 'models'],
        })
        toast(`Provider "${provider.name}" removed`, { type: 'success' })
      }
    } catch {
      toast('Network error — could not remove provider.', { type: 'error' })
    } finally {
      setDeletingId(null)
    }
  }

  async function saveSetting(payload: SaveSettingPayload) {
    await saveMutation.mutateAsync(payload)
  }

  function handleWizardOpenChange(open: boolean) {
    setWizardOpen(open)
    if (!open) {
      setEditingProvider(null)
    }
  }

  const totalSearchMatches = filteredSettings.length

  if (!configAvailable) {
    return (
      <div
        className={cn(
          embedded ? 'h-full bg-[var(--theme-panel)]' : 'min-h-full bg-surface',
        )}
      >
        <BackendUnavailableState
          feature="Provider Setup"
          description={getUnavailableReason('config')}
        />
      </div>
    )
  }

  return (
    <div
      data-route-page
      className={cn(
        embedded ? 'h-full bg-[var(--theme-panel)]' : 'min-h-full bg-surface',
      )}
    >
      <main
        className={cn(
          'min-h-full px-4 pb-24 pt-5 text-[var(--theme-text)] md:px-6 md:pt-8',
          embedded && 'px-4 pb-6 pt-4 md:px-6 md:pb-6 md:pt-4',
        )}
      >
        <section className="mx-auto w-full max-w-[1480px] space-y-5">
          <header className="flex flex-col gap-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-5 py-4 shadow-sm">
            <div className="space-y-1">
              <h1 className="hidden md:block text-lg font-semibold text-[var(--theme-text)]">
                Settings
              </h1>
              <p className="text-sm text-[var(--theme-muted)]">
                Configure providers plus Hermes Agent defaults in one place.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <label className="relative w-full md:max-w-md">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--theme-muted)]">
                  <HugeiconsIcon
                    icon={Search01Icon}
                    size={18}
                    strokeWidth={1.8}
                  />
                </span>
                <Input
                  value={search}
                  type="search"
                  placeholder="Search settings, paths, or descriptions"
                  className="pl-10"
                  onChange={(event) => {
                    setSearch(event.target.value)
                  }}
                />
              </label>

              <div className="text-sm text-[var(--theme-muted)]">
                {searchQuery
                  ? `${totalSearchMatches} matching setting${totalSearchMatches === 1 ? '' : 's'}`
                  : `${SETTINGS.length} configurable defaults`}
              </div>
            </div>
          </header>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as SettingsTabId)}
          >
            <TabsList
              variant="underline"
              className="w-full flex-nowrap overflow-x-auto justify-start gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2"
            >
              {TAB_ORDER.map((tab) => {
                const count =
                  tab.id === 'providers'
                    ? providerSummaries.length
                    : settingsByTab[tab.id].length
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="rounded-lg px-3 py-2 text-sm"
                  >
                    {tab.label}
                    <span className="ml-1 rounded-full bg-[var(--theme-hover)] px-1.5 py-0.5 text-[11px] text-[var(--theme-muted)]">
                      {count}
                    </span>
                  </TabsTrigger>
                )
              })}
            </TabsList>

            <TabsContent value="providers" className="space-y-5">
              <ActiveModelCard modelOptions={modelOptions} />
              <ProviderManagementSection
                embedded={embedded}
                providerSummaries={providerSummaries}
                modelsQuery={modelsQuery}
                deletingId={deletingId}
                onAddProvider={() => {
                  setEditingProvider(null)
                  setWizardOpen(true)
                }}
                onEdit={handleEdit}
                onDelete={(provider) => {
                  void handleDelete(provider)
                }}
              />
            </TabsContent>

            {TAB_ORDER.filter((tab) => tab.id !== 'providers').map((tab) => {
              const items = settingsByTab[tab.id]
              return (
                <TabsContent key={tab.id} value={tab.id} className="space-y-4">
                  {configQuery.isPending ? (
                    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-3 text-sm text-[var(--theme-muted)]">
                      Loading current configuration...
                    </div>
                  ) : null}

                  {configQuery.error ? (
                    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-3">
                      <p className="text-sm text-[var(--theme-muted)]">
                        Unable to load configuration right now.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => configQuery.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}

                  {!configQuery.isPending &&
                  !configQuery.error &&
                  items.length === 0 ? (
                    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-4 text-sm text-[var(--theme-muted)]">
                      No settings in this tab match your current search.
                    </div>
                  ) : null}

                  {!configQuery.isPending && !configQuery.error
                    ? items.map((setting) => (
                        <SettingCard
                          key={setting.id}
                          setting={setting}
                          config={configQuery.data}
                          draftValues={draftValues}
                          setDraftValues={setDraftValues}
                          saveSetting={saveSetting}
                          isSaving={saveMutation.isPending}
                          savePath={saveMutation.variables?.path ?? null}
                          modelOptions={modelOptions}
                        />
                      ))
                    : null}
                </TabsContent>
              )
            })}
          </Tabs>
        </section>

        {/* System / Reset section */}
        <ResetEnvironmentSection />
      </main>

      <ProviderWizard
        open={wizardOpen}
        onOpenChange={handleWizardOpenChange}
        editProvider={editingProvider}
      />
    </div>
  )
}
