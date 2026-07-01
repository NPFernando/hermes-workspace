import { useState } from 'react'
import type { ThemeId } from '@/lib/theme'
import { THEMES, getTheme, isDarkTheme, setTheme } from '@/lib/theme'
import { useSettings } from '@/hooks/use-settings'
import { cn } from '@/lib/utils'

function PageThemeSwatch({
  colors,
}: {
  colors: {
    bg: string
    panel: string
    border: string
    accent: string
    text: string
  }
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

const THEME_PREVIEWS: Record<
  ThemeId,
  { bg: string; panel: string; border: string; accent: string; text: string }
> = {
  'claude-nous': {
    bg: '#031a1a',
    panel: '#082224',
    border: 'rgba(255,255,255,0.12)',
    accent: '#ffac02',
    text: '#f8f1e3',
  },
  'claude-nous-light': {
    bg: '#F8FAF8',
    panel: '#FBFDFB',
    border: 'rgba(30,74,92,0.18)',
    accent: '#2557B7',
    text: '#16315F',
  },
  'claude-official': {
    bg: '#0A0E1A',
    panel: '#11182A',
    border: '#24304A',
    accent: '#6366F1',
    text: '#E6EAF2',
  },
  'claude-official-light': {
    bg: '#F7F7F1',
    panel: '#FAFBF6',
    border: '#CDD5DA',
    accent: '#2557B7',
    text: '#16315F',
  },
  'claude-classic': {
    bg: '#0d0f12',
    panel: '#1a1f26',
    border: '#2a313b',
    accent: '#b98a44',
    text: '#eceff4',
  },
  'claude-slate': {
    bg: '#0d1117',
    panel: '#1c2128',
    border: '#30363d',
    accent: '#7eb8f6',
    text: '#c9d1d9',
  },
  'claude-classic-light': {
    bg: '#F5F2ED',
    panel: '#FFFFFF',
    border: '#D9D0C4',
    accent: '#b98a44',
    text: '#1a1f26',
  },
  'matrix': {
    bg: '#020804',
    panel: '#07130A',
    border: 'rgba(0,255,65,0.28)',
    accent: '#00FF41',
    text: '#D8FFE3',
  },
  'matrix-light': {
    bg: '#F4FFF6',
    panel: '#FFFFFF',
    border: 'rgba(0,126,34,0.2)',
    accent: '#008F2D',
    text: '#062A12',
  },
  'claude-slate-light': {
    bg: '#F6F8FA',
    panel: '#FFFFFF',
    border: '#D0D7DE',
    accent: '#3b82f6',
    text: '#1F2328',
  },
  'scifi': {
    bg: '#060b18',
    panel: '#0a1628',
    border: '#1a3a5c',
    accent: '#00f0ff',
    text: '#e0f7fa',
  },
  'scifi-light': {
    bg: '#EEF1F5',
    panel: '#FFFFFF',
    border: '#B0BEC5',
    accent: '#0097A7',
    text: '#0A1628',
  },
  'odysseus': {
    bg: '#282c34',
    panel: '#111111',
    border: 'rgba(53,90,102,0.5)',
    accent: '#e06c75',
    text: '#9cdef2',
  },
}

export function WorkspaceThemePicker() {
  const { updateSettings } = useSettings()
  const [current, setCurrent] = useState<ThemeId>(() => getTheme())

  function applyWorkspaceTheme(id: ThemeId) {
    setTheme(id)
    updateSettings({ theme: isDarkTheme(id) ? 'dark' : 'light' })
    setCurrent(id)
  }

  return (
    <div className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
      {THEMES.map((t) => {
        const isActive = current === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => applyWorkspaceTheme(t.id)}
            className={cn(
              'card-glow flex min-h-[112px] flex-col gap-2.5 rounded-xl border p-3.5 text-left transition-all',
              isActive
                ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-subtle)] text-[var(--theme-text)] shadow-sm'
                : 'border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-text)] hover:-translate-y-0.5 hover:bg-[var(--theme-card2)]',
            )}
          >
            <PageThemeSwatch colors={THEME_PREVIEWS[t.id]} />
            <div className="flex items-center gap-1.5">
              <span className="text-xs">{t.icon}</span>
              <span className="text-xs font-semibold">{t.label}</span>
              {isActive && (
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-[var(--theme-accent)]">
                  Active
                </span>
              )}
            </div>
            <p className="text-[10px] leading-tight text-[var(--theme-muted)]">
              {t.description}
            </p>
          </button>
        )
      })}
    </div>
  )
}

