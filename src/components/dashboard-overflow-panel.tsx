import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  BrainIcon,
  Cancel01Icon,
  ComputerTerminal01Icon,
  File01Icon,
  McpServerIcon,
  MessageMultiple01Icon,
  Moon02Icon,
  PuzzleIcon,
  Rocket01Icon,
  Settings01Icon,
  Sun02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/hooks/use-settings'
import { Z_LAYER } from '@/lib/z-layers'
import {
  getTheme,
  getThemeVariant,
  isDarkTheme,
  setTheme as setThemeFamily,
} from '@/lib/theme'

type OverflowItem = {
  icon: typeof File01Icon
  label: string
  to: string
}

const SYSTEM_ITEMS: Array<OverflowItem> = [
  { icon: File01Icon, label: 'Files', to: '/files' },
  { icon: ComputerTerminal01Icon, label: 'Terminal', to: '/terminal' },
  { icon: BrainIcon, label: 'Memory', to: '/memory' },
]

const CLAUDE_ITEMS: Array<OverflowItem> = [
  { icon: MessageMultiple01Icon, label: 'Chat', to: '/chat' },
  { icon: Rocket01Icon, label: 'Dify', to: '/dify' },
  { icon: PuzzleIcon, label: 'Skills', to: '/skills' },
  { icon: McpServerIcon, label: 'MCP', to: '/mcp' },
  { icon: UserGroupIcon, label: 'Profiles', to: '/profiles' },
  { icon: Settings01Icon, label: 'Settings', to: '/settings' },
]

type Props = {
  open: boolean
  onClose: () => void
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function OverflowGrid({
  title,
  items,
  onSelect,
}: {
  title: string
  items: Array<OverflowItem>
  onSelect: (to: string) => void
}) {
  return (
    <section>
      <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button
            key={item.to}
            type="button"
            onClick={() => onSelect(item.to)}
            className={cn(
              'flex min-h-12 items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-left',
              'text-sm text-ink motion-safe:transition-colors hover:border-accent-200 hover:bg-accent-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]',
            )}
          >
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-[var(--theme-hover)] text-[var(--theme-muted)]">
              <HugeiconsIcon icon={item.icon} size={16} strokeWidth={1.6} />
            </span>
            <span className="truncate font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function DashboardOverflowPanel({ open, onClose }: Props) {
  const navigate = useNavigate()
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const focusFrame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(first ?? panel).focus()
    })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown)
      const previous = previousFocusRef.current
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  if (!open) return null

  function handleSelect(to: string) {
    onClose()
    void navigate({ to, search: {} })
  }

  // Detect actual current theme family from data-theme attribute
  const currentDataTheme =
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme') || 'claude-nous'
      : 'claude-nous'
  const isDark = !currentDataTheme.endsWith('-light')
  const themeIcon = isDark ? Sun02Icon : Moon02Icon
  const themeLabel = isDark ? 'Light mode' : 'Dark mode'
  const nextTheme = isDark ? 'light mode' : 'dark mode'

  function toggleThemeWithinFamily() {
    const current = getTheme()
    const dark = isDarkTheme(current)
    const next = getThemeVariant(current, dark ? 'light' : 'dark')
    setThemeFamily(next)
    updateSettings({ theme: dark ? 'light' : 'dark' })
  }

  return (
    <div className={`fixed inset-0 no-swipe md:hidden ${Z_LAYER.modal}`}>
      <button
        type="button"
        className="absolute inset-0 bg-black/40 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
        aria-label="Close overflow panel"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-overflow-title"
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 pb-[calc(env(safe-area-inset-bottom)+5rem)] shadow-2xl outline-none motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-200"
      >
        <div className="mb-3 h-1.5 w-10 rounded-full bg-[var(--theme-hover)] mx-auto" />
        <div className="space-y-4">
          <section>
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <h2
                id="dashboard-overflow-title"
                className="text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-muted)]"
              >
                Quick Menu
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close overflow panel"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)] md:min-h-0 md:min-w-0"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={17}
                  strokeWidth={1.8}
                />
              </button>
            </div>
            <button
              type="button"
              onClick={toggleThemeWithinFamily}
              className="flex w-full items-center justify-between rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-left text-sm text-ink motion-safe:transition-colors hover:border-accent-200 hover:bg-accent-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]"
            >
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-[var(--theme-hover)] text-[var(--theme-muted)]">
                  <HugeiconsIcon icon={themeIcon} size={16} strokeWidth={1.6} />
                </span>
                <span className="font-medium">{themeLabel}</span>
              </span>
              <span className="text-xs text-[var(--theme-muted)]">
                Tap for {nextTheme}
              </span>
            </button>
          </section>
          <OverflowGrid
            title="System"
            items={SYSTEM_ITEMS}
            onSelect={handleSelect}
          />
          <OverflowGrid
            title="Hermes Agent"
            items={CLAUDE_ITEMS}
            onSelect={handleSelect}
          />
        </div>
      </div>
    </div>
  )
}
