import {
  ComputerIcon,
  Moon01Icon,
  Sun01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState } from 'react'
import { Row, SETTINGS_CARD_CLASS, SectionHeader } from './settings-dialog-primitives'
import type { AccentColor, SettingsThemeMode } from '@/hooks/use-settings'
import type { ThemeId } from '@/lib/theme'
import { applyTheme, useSettings } from '@/hooks/use-settings'
import {
  THEMES,
  getTheme,
  getThemeVariant,
  isDarkTheme,
  setTheme,
} from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { applyAccentColor } from '@/lib/accent-colors'

export function AppearanceContent() {
  const { settings, updateSettings } = useSettings()

  function handleThemeChange(value: string) {
    const theme = value as SettingsThemeMode
    applyTheme(theme)
    if (theme === 'light' || theme === 'dark') {
      setTheme(getThemeVariant(getTheme(), theme))
    }
    updateSettings({ theme })
  }

  function _badgeClass(color: AccentColor): string {
    if (color === 'orange') return 'bg-orange-500'
    if (color === 'purple') return 'bg-purple-500'
    if (color === 'blue') return 'bg-blue-500'
    return 'bg-green-500'
  }

  function _handleAccentColorChange(selectedAccent: AccentColor) {
    localStorage.setItem('claude-accent', selectedAccent)
    document.documentElement.setAttribute('data-accent', selectedAccent)
    applyAccentColor(selectedAccent)
    updateSettings({ accentColor: selectedAccent })
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Appearance"
        description="Theme and color accents."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
          Theme Mode
        </p>
        <div className="inline-flex rounded-lg border border-[var(--theme-border)] p-1">
          {[
            { value: 'light', label: 'Light', icon: Sun01Icon },
            { value: 'dark', label: 'Dark', icon: Moon01Icon },
            { value: 'system', label: 'System', icon: ComputerIcon },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleThemeChange(option.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                settings.theme === option.value
                  ? 'bg-accent-500 text-white'
                  : 'text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]',
              )}
            >
              <HugeiconsIcon icon={option.icon} size={16} strokeWidth={1.5} />
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {/* Accent color removed — themes control accent */}
      <div className={SETTINGS_CARD_CLASS}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
          Enterprise Theme
        </p>
        <EnterpriseThemePicker />
      </div>
      <div className={SETTINGS_CARD_CLASS}>
        <Row
          label="System metrics footer"
          description="Show a persistent footer with CPU, RAM, disk, and Hermes Agent status."
        >
          <Switch
            checked={settings.showSystemMetricsFooter}
            onCheckedChange={(c) =>
              updateSettings({ showSystemMetricsFooter: c })
            }
            aria-label="Show system metrics footer"
          />
        </Row>

        {/* Mobile chat nav removed — not relevant for Hermes */}
      </div>
    </div>
  )
}

const ENTERPRISE_THEME_FAMILIES: Array<ThemeId> = [
  'claude-nous',
  'matrix',
  'claude-official',
  'claude-classic',
  'claude-slate',
]

const ENTERPRISE_THEMES = THEMES.map((theme) => ({
  ...theme,
  desc: theme.description,
  preview:
    theme.id === 'claude-nous'
      ? {
          bg: '#041C1C',
          panel: '#06282A',
          border: 'rgba(255,230,203,0.2)',
          accent: '#FFAC02',
          text: '#FFE6CB',
        }
      : theme.id === 'claude-nous-light'
        ? {
            bg: '#F8FAF8',
            panel: '#FBFDFB',
            border: 'rgba(30,74,92,0.18)',
            accent: '#2557B7',
            text: '#16315F',
          }
        : theme.id === 'matrix'
          ? {
              bg: '#020804',
              panel: '#07130A',
              border: 'rgba(0,255,65,0.28)',
              accent: '#00FF41',
              text: '#D8FFE3',
            }
          : theme.id === 'matrix-light'
            ? {
                bg: '#F4FFF6',
                panel: '#FFFFFF',
                border: 'rgba(0,126,34,0.2)',
                accent: '#008F2D',
                text: '#062A12',
              }
            : theme.id === 'claude-official'
              ? {
                  bg: '#0A0E1A',
                  panel: '#11182A',
                  border: '#24304A',
                  accent: '#6366F1',
                  text: '#E6EAF2',
                }
              : theme.id === 'claude-official-light'
                ? {
                    bg: '#F7F7F1',
                    panel: '#FAFBF6',
                    border: '#CDD5DA',
                    accent: '#2557B7',
                    text: '#16315F',
                  }
                : theme.id === 'claude-classic'
              ? {
                  bg: '#0d0f12',
                  panel: '#1a1f26',
                  border: '#2a313b',
                  accent: '#b98a44',
                  text: '#eceff4',
                }
              : theme.id === 'claude-classic-light'
                ? {
                    bg: '#F5F2ED',
                    panel: '#FCFAF7',
                    border: '#D8CCBC',
                    accent: '#b98a44',
                    text: '#1a1f26',
                  }
                : theme.id === 'claude-slate'
                  ? {
                      bg: '#0d1117',
                      panel: '#1c2128',
                      border: '#30363d',
                      accent: '#7eb8f6',
                      text: '#c9d1d9',
                    }
                  : {
                      bg: '#F6F8FA',
                      panel: '#FFFFFF',
                      border: '#D0D7DE',
                      accent: '#3b82f6',
                      text: '#24292f',
                    },
}))

function ThemeSwatch({
  colors,
}: {
  colors: (typeof ENTERPRISE_THEMES)[number]['preview']
}) {
  return (
    <div
      className="flex h-10 w-full overflow-hidden rounded-md border"
      style={{ borderColor: colors.border, backgroundColor: colors.bg }}
    >
      <div
        className="flex h-full w-4 flex-col gap-0.5 p-0.5"
        style={{ backgroundColor: colors.panel }}
      >
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1.5 w-full rounded-sm"
            style={{ backgroundColor: colors.border }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-1">
        <div
          className="h-1.5 w-3/4 rounded"
          style={{ backgroundColor: colors.text, opacity: 0.8 }}
        />
        <div
          className="h-1 w-1/2 rounded"
          style={{ backgroundColor: colors.text, opacity: 0.3 }}
        />
        <div
          className="mt-0.5 h-1.5 w-6 rounded-full"
          style={{ backgroundColor: colors.accent }}
        />
      </div>
    </div>
  )
}

function EnterpriseThemePicker() {
  const { updateSettings } = useSettings()
  const [current, setCurrent] = useState(() => {
    if (typeof window === 'undefined') return 'claude-nous'
    return getTheme()
  })
  const currentMode = isDarkTheme(current) ? 'dark' : 'light'

  useEffect(() => {
    setCurrent(getTheme())
  }, [])

  function applyEnterpriseTheme(id: ThemeId) {
    setTheme(id)
    updateSettings({ theme: isDarkTheme(id) ? 'dark' : 'light' })
    setCurrent(id)
  }

  function toggleEnterpriseThemeMode() {
    const nextMode = currentMode === 'dark' ? 'light' : 'dark'
    applyEnterpriseTheme(getThemeVariant(current, nextMode))
  }

  const visibleThemes = ENTERPRISE_THEME_FAMILIES.map((themeId) =>
    ENTERPRISE_THEMES.find(
      (theme) => theme.id === getThemeVariant(themeId, currentMode),
    ),
  ).filter(Boolean) as typeof ENTERPRISE_THEMES

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-[var(--theme-border)] px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-[var(--theme-text)]">
            {currentMode === 'dark' ? 'Dark mode' : 'Light mode'}
          </p>
          <p className="text-[11px] text-[var(--theme-muted)]">
            Toggle the current theme family between paired light and dark
            variants.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleEnterpriseThemeMode}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-hover)]"
          aria-label={
            currentMode === 'dark'
              ? 'Switch enterprise theme to light mode'
              : 'Switch enterprise theme to dark mode'
          }
        >
          <HugeiconsIcon
            icon={currentMode === 'dark' ? Sun01Icon : Moon01Icon}
            size={16}
            strokeWidth={1.5}
          />
          {currentMode === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="grid w-full grid-cols-2 gap-2">
        {visibleThemes.map((t) => {
          const isActive = current === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => applyEnterpriseTheme(t.id)}
              className={cn(
                'flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors',
                isActive
                  ? 'border-accent-500 bg-accent-50 text-accent-700'
                  : 'border-[var(--theme-border)] bg-[var(--theme-panel)] hover:bg-[var(--theme-hover)]',
              )}
            >
              <ThemeSwatch colors={t.preview} />
              <div className="flex items-center gap-1">
                <span className="text-xs">{t.icon}</span>
                <span className="text-xs font-semibold text-[var(--theme-text)]">
                  {t.label}
                </span>
                {isActive && (
                  <span className="ml-auto text-[9px] font-bold text-accent-600 uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[10px] text-[var(--theme-muted)] leading-tight">
                {t.desc}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
