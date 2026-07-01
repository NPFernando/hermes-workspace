import {
  Notification03Icon,
  PaintBoardIcon,
  Settings02Icon,
  SourceCodeSquareIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { SettingsNavId } from '@/components/settings/settings-sidebar'
import type { LocaleId } from '@/lib/i18n'
import { HarpConfigScreen } from '@/screens/settings/harp-config-screen'
import {
  SETTINGS_NAV_ITEMS,
  SettingsMobilePills,
  SettingsSidebar,
} from '@/components/settings/settings-sidebar'
import { usePageTitle } from '@/hooks/use-page-title'
import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/hooks/use-settings'
import { LOCALE_LABELS, getLocale, setLocale } from '@/lib/i18n'
import {
  SettingsRow,
  SettingsSection,
} from '@/screens/settings/sections/settings-primitives'
import { WorkspaceThemePicker } from '@/screens/settings/sections/workspace-theme-picker'
import { ChatDisplaySection } from '@/screens/settings/sections/chat-display-section'
import { MobileAppSection } from '@/screens/settings/sections/mobile-app-section'
import { NetworkAccessSection } from '@/screens/settings/sections/network-access-section'
import { WhatsNewSection } from '@/screens/settings/sections/whats-new-section'
import { ClaudeConfigSection } from '@/screens/settings/sections/claude-config-section'
import { ConnectionSection } from '@/screens/settings/sections/connection-section'


const VALID_SECTION_IDS: ReadonlyArray<SettingsNavId> = SETTINGS_NAV_ITEMS.map(
  (item) => item.id,
)

export const Route = createFileRoute('/settings/')({
  ssr: false,
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: SettingsNavId } => {
    const raw = typeof search.section === 'string' ? search.section : undefined
    if (raw && (VALID_SECTION_IDS as ReadonlyArray<string>).includes(raw)) {
      return { section: raw as SettingsNavId }
    }
    return {}
  },
  component: SettingsRoute,
})


type SettingsSectionId = SettingsNavId

function SettingsRoute() {
  usePageTitle('Settings')
  const { settings, updateSettings } = useSettings()

  // Phase 4.2: Fetch models for preferred model dropdowns
  const [availableModels, setAvailableModels] = useState<
    Array<{ id: string; label: string }>
  >([])
  const [modelsError, setModelsError] = useState(false)

  useEffect(() => {
    async function fetchModels() {
      setModelsError(false)
      try {
        const res = await fetch('/api/models')
        if (!res.ok) {
          setModelsError(true)
          return
        }
        const data = await res.json()
        const models = Array.isArray(data.models) ? data.models : []
        setAvailableModels(
          models.map((m: any) => ({
            id: m.id || '',
            label: m.id?.split('/').pop() || m.id || '',
          })),
        )
      } catch {
        setModelsError(true)
      }
    }
    void fetchModels()
  }, [])

  const { section } = Route.useSearch()
  const activeSection: SettingsSectionId = section ?? 'claude'

  return (
    <div className="min-h-dvh bg-surface text-[var(--theme-text)]">
      <div className="pointer-events-none fixed inset-0 bg-radial from-[var(--theme-accent)]/10 via-transparent to-transparent" />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-[var(--theme-hover)]/60 via-transparent to-[var(--theme-hover)]/30" />

      <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pt-6 pb-24 sm:px-6 md:flex-row md:gap-6 md:pb-8 lg:pt-8">
        <SettingsSidebar activeId={activeSection} />

        <SettingsMobilePills activeId={activeSection} />

        {/* Content area */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* -- Connection ------------------ */}
          {activeSection === 'connection' && <ConnectionSection />}

          {/* ── Hermes Agent ──────────────────────────────────── */}
          {activeSection === 'claude' && (
            <ClaudeConfigSection activeView="claude" />
          )}
          {activeSection === 'agent' && (
            <ClaudeConfigSection activeView="agent" />
          )}
          {activeSection === 'routing' && (
            <ClaudeConfigSection activeView="routing" />
          )}
          {/* ── HARP Routing ──────────────────────────────────── */}
          {activeSection === 'harp' && <HarpConfigScreen />}
          {activeSection === 'voice' && (
            <ClaudeConfigSection activeView="voice" />
          )}
          {activeSection === 'display' && (
            <ClaudeConfigSection activeView="display" />
          )}

          {/* ── Appearance ──────────────────────────────────────── */}
          {activeSection === 'appearance' && (
            <>
              <SettingsSection
                title="Appearance"
                description="Choose a workspace theme and accent color."
                icon={PaintBoardIcon}
              >
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--theme-text)]">
                      Theme
                    </p>
                    <p className="text-xs text-[var(--theme-muted)] text-pretty">
                      Choose the workspace palette. Light and dark variants are
                      both available.
                    </p>
                  </div>
                  <WorkspaceThemePicker />
                  <div className="grid gap-3 pt-3 md:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-[var(--theme-text)]">
                        Interface font
                      </span>
                      <select
                        value={settings.interfaceFont}
                        onChange={(event) =>
                          updateSettings({
                            interfaceFont: event.target.value as typeof settings.interfaceFont,
                          })
                        }
                        className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
                      >
                        <option value="system">System sans</option>
                        <option value="inter">Inter-style sans</option>
                        <option value="serif">Serif</option>
                        <option value="mono">Monospace</option>
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-[var(--theme-text)]">
                        Spacing density
                      </span>
                      <select
                        value={settings.interfaceDensity}
                        onChange={(event) =>
                          updateSettings({
                            interfaceDensity: event.target.value as typeof settings.interfaceDensity,
                          })
                        }
                        className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
                      >
                        <option value="compact">Compact</option>
                        <option value="comfortable">Comfortable</option>
                        <option value="spacious">Spacious</option>
                      </select>
                    </label>
                  </div>
                </div>
              </SettingsSection>

              <SettingsSection
                title="Labs (experimental)"
                description="Early/unfinished features. May change or be removed. Off by default."
                icon={Settings02Icon}
              >
                <SettingsRow
                  label="Echo Studio"
                  description="Show the Echo Studio dashboard builder (scaffold) in the nav. Experimental."
                >
                  <Switch
                    checked={settings.experimentalEchoStudio}
                    onCheckedChange={(checked) =>
                      updateSettings({ experimentalEchoStudio: checked })
                    }
                    aria-label="Enable Echo Studio (experimental)"
                  />
                </SettingsRow>
              </SettingsSection>
            </>
          )}

          {/* ── Chat ────────────────────────────────────────────── */}
          {activeSection === 'chat' && <ChatDisplaySection />}

          {/* ── Editor ──────────────────────────────────────────── */}
          {activeSection === ('editor' as SettingsSectionId) && (
            <SettingsSection
              title="Editor"
              description="Configure Monaco defaults for the files workspace."
              icon={SourceCodeSquareIcon}
            >
              <SettingsRow
                label="Font size"
                description="Adjust editor font size between 12 and 20."
              >
                <div className="flex w-full items-center gap-2 md:max-w-xs">
                  <input
                    type="range"
                    min={12}
                    max={20}
                    value={settings.editorFontSize}
                    onChange={(e) =>
                      updateSettings({ editorFontSize: Number(e.target.value) })
                    }
                    className="w-full accent-[var(--theme-text)]"
                    aria-label={`Editor font size: ${settings.editorFontSize} pixels`}
                    aria-valuemin={12}
                    aria-valuemax={20}
                    aria-valuenow={settings.editorFontSize}
                  />
                  <span className="w-12 text-right text-sm tabular-nums text-[var(--theme-muted)]">
                    {settings.editorFontSize}px
                  </span>
                </div>
              </SettingsRow>
              <SettingsRow
                label="Word wrap"
                description="Wrap long lines in the editor by default."
              >
                <Switch
                  checked={settings.editorWordWrap}
                  onCheckedChange={(checked) =>
                    updateSettings({ editorWordWrap: checked })
                  }
                  aria-label="Word wrap"
                />
              </SettingsRow>
              <SettingsRow
                label="Minimap"
                description="Show minimap preview in Monaco editor."
              >
                <Switch
                  checked={settings.editorMinimap}
                  onCheckedChange={(checked) =>
                    updateSettings({ editorMinimap: checked })
                  }
                  aria-label="Show minimap"
                />
              </SettingsRow>
            </SettingsSection>
          )}

          {/* ── Notifications ───────────────────────────────────── */}
          {activeSection === ('language' as SettingsSectionId) && (
            <SettingsSection
              title="Language"
              description="Choose the display language for the workspace UI."
              icon={Settings02Icon}
            >
              <SettingsRow
                label="Interface Language"
                description="Translates navigation, labels, and buttons. Content from the agent remains in the agent's language."
              >
                <select
                  value={getLocale()}
                  onChange={(e) => {
                    setLocale(e.target.value as LocaleId)
                    window.location.reload()
                  }}
                  className="h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-sm text-[var(--theme-text)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] md:max-w-xs"
                >
                  {(
                    Object.entries(LOCALE_LABELS) as Array<[LocaleId, string]>
                  ).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            </SettingsSection>
          )}

          {activeSection === 'notifications' && (
            <>
              <SettingsSection
                title="Notifications"
                description="Control alert delivery and usage warning threshold."
                icon={Notification03Icon}
              >
                <SettingsRow
                  label="Enable alerts"
                  description="Show usage and system alert notifications."
                >
                  <Switch
                    checked={settings.notificationsEnabled}
                    onCheckedChange={(checked) =>
                      updateSettings({ notificationsEnabled: checked })
                    }
                    aria-label="Enable alerts"
                  />
                </SettingsRow>
                <SettingsRow
                  label="Usage threshold"
                  description="Set usage warning trigger between 50% and 100%."
                >
                  <div className="flex w-full items-center gap-2 md:max-w-xs">
                    <input
                      type="range"
                      min={50}
                      max={100}
                      value={settings.usageThreshold}
                      onChange={(e) =>
                        updateSettings({
                          usageThreshold: Number(e.target.value),
                        })
                      }
                      className="w-full accent-[var(--theme-text)] disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!settings.notificationsEnabled}
                      aria-label={`Usage threshold: ${settings.usageThreshold} percent`}
                      aria-valuemin={50}
                      aria-valuemax={100}
                      aria-valuenow={settings.usageThreshold}
                    />
                    <span className="w-12 text-right text-sm tabular-nums text-[var(--theme-muted)]">
                      {settings.usageThreshold}%
                    </span>
                  </div>
                </SettingsRow>
              </SettingsSection>

              <SettingsSection
                title="Smart Suggestions"
                description="Get proactive model suggestions to optimize cost and quality."
                icon={Settings02Icon}
              >
                <SettingsRow
                  label="Enable smart suggestions"
                  description="Suggest cheaper models for simple tasks or better models for complex work."
                >
                  <Switch
                    checked={settings.smartSuggestionsEnabled}
                    onCheckedChange={(checked) =>
                      updateSettings({ smartSuggestionsEnabled: checked })
                    }
                    aria-label="Enable smart suggestions"
                  />
                </SettingsRow>
                <SettingsRow
                  label="Preferred budget model"
                  description="Default model for cheaper suggestions (leave empty for auto-detect)."
                >
                  <select
                    value={settings.preferredBudgetModel}
                    onChange={(e) =>
                      updateSettings({ preferredBudgetModel: e.target.value })
                    }
                    className="h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-sm text-[var(--theme-text)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] md:max-w-xs"
                    aria-label="Preferred budget model"
                  >
                    <option value="">Auto-detect</option>
                    {modelsError && (
                      <option disabled>Failed to load models</option>
                    )}
                    {availableModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
                <SettingsRow
                  label="Preferred premium model"
                  description="Default model for upgrade suggestions (leave empty for auto-detect)."
                >
                  <select
                    value={settings.preferredPremiumModel}
                    onChange={(e) =>
                      updateSettings({ preferredPremiumModel: e.target.value })
                    }
                    className="h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-sm text-[var(--theme-text)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] md:max-w-xs"
                    aria-label="Preferred premium model"
                  >
                    <option value="">Auto-detect</option>
                    {modelsError && (
                      <option disabled>Failed to load models</option>
                    )}
                    {availableModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
                <SettingsRow
                  label="Only suggest cheaper models"
                  description="Never suggest upgrades, only suggest cheaper alternatives."
                >
                  <Switch
                    checked={settings.onlySuggestCheaper}
                    onCheckedChange={(checked) =>
                      updateSettings({ onlySuggestCheaper: checked })
                    }
                    aria-label="Only suggest cheaper models"
                  />
                </SettingsRow>
              </SettingsSection>
            </>
          )}

          {/* ── Android App ─────────────────────────────────────── */}
          {activeSection === 'mobile' && <MobileAppSection />}

          {/* ── Network Access ──────────────────────────────────── */}
          {activeSection === 'network' && <NetworkAccessSection />}

          {/* ── What's New ──────────────────────────────────────── */}
          {activeSection === 'whatsnew' && <WhatsNewSection />}

          <footer className="mt-auto pt-4">
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3 text-sm text-[var(--theme-muted)] backdrop-blur-sm">
              <HugeiconsIcon
                icon={Settings02Icon}
                size={20}
                strokeWidth={1.5}
              />
              <span className="text-pretty">
                Changes are saved automatically to local storage.
              </span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  )
}
