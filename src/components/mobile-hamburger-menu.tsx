import { useNavigate, useRouterState } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  BrainIcon,
  Cancel01Icon,
  ChartCandleIcon,
  Chat01Icon,
  Clock01Icon,
  CommandLineIcon,
  DashboardSquare01Icon,
  File01Icon,
  McpServerIcon,
  Menu01Icon,
  PuzzleIcon,
  Rocket01Icon,
  Settings01Icon,
  Telescope02Icon,
  UserGroupIcon,
  UserMultipleIcon,
  Wallet03Icon,
} from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { hapticTap } from '@/lib/haptics'
import { getTheme, getThemeVariant, isDarkTheme, setTheme } from '@/lib/theme'
import {
  selectChatProfileDisplayName,
  useChatSettingsStore,
} from '@/hooks/use-chat-settings'
import { useSettingsStore } from '@/hooks/use-settings'
import { Z_LAYER } from '@/lib/z-layers'
import { logoutWorkspace } from '@/lib/auth-session'

export const MOBILE_HAMBURGER_NAV_ITEMS = [
  {
    id: 'chat',
    label: 'Chat',
    icon: Chat01Icon,
    to: '/chat/main',
    match: (p: string) => p.startsWith('/chat') || p === '/new' || p === '/',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: DashboardSquare01Icon,
    to: '/dashboard',
    match: (p: string) => p.startsWith('/dashboard'),
  },
  {
    id: 'research',
    label: 'Research',
    icon: Telescope02Icon,
    to: '/research',
    match: (p: string) => p.startsWith('/research'),
  },
  {
    id: 'files',
    label: 'Files',
    icon: File01Icon,
    to: '/files',
    match: (p: string) => p.startsWith('/files'),
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: CommandLineIcon,
    to: '/terminal',
    match: (p: string) => p.startsWith('/terminal'),
  },
  {
    id: 'jobs',
    label: 'Jobs',
    icon: Clock01Icon,
    to: '/jobs',
    match: (p: string) => p.startsWith('/jobs'),
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: ChartCandleIcon,
    to: '/trading',
    match: (p: string) => p.startsWith('/trading') || p.startsWith('/finance'),
  },
  {
    id: 'personal-finance',
    label: 'Personal Finance',
    icon: Wallet03Icon,
    to: '/personal-finance',
    match: (p: string) => p.startsWith('/personal-finance'),
  },
  {
    id: 'command',
    label: 'Command Center',
    icon: UserMultipleIcon,
    to: '/command',
    match: (p: string) =>
      p.startsWith('/command') ||
      p.startsWith('/operations') ||
      p.startsWith('/agents'),
  },
  {
    id: 'conductor',
    label: 'Conductor',
    icon: Rocket01Icon,
    to: '/conductor',
    match: (p: string) => p.startsWith('/conductor'),
  },
  {
    id: 'dify',
    label: 'Dify Workbench',
    icon: Rocket01Icon,
    to: '/dify',
    match: (p: string) => p.startsWith('/dify'),
  },
  {
    id: 'swarm',
    label: 'Swarm',
    icon: UserGroupIcon,
    to: '/swarm',
    match: (p: string) =>
      p === '/swarm' || p.startsWith('/swarm/') || p.startsWith('/swarm2'),
  },
  {
    id: 'echo-studio',
    label: 'Echo Studio',
    icon: Rocket01Icon,
    to: '/echo-studio',
    match: (p: string) => p.startsWith('/echo-studio'),
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: BrainIcon,
    to: '/memory',
    match: (p: string) => p.startsWith('/memory'),
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: PuzzleIcon,
    to: '/skills',
    match: (p: string) => p.startsWith('/skills'),
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: McpServerIcon,
    to: '/mcp',
    match: (p: string) => p.startsWith('/mcp'),
  },
  {
    id: 'profiles',
    label: 'Profiles',
    icon: UserGroupIcon,
    to: '/profiles',
    match: (p: string) => p.startsWith('/profiles'),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings01Icon,
    to: '/settings',
    match: (p: string) => p.startsWith('/settings'),
  },
]

/** Shared drawer state — used by both the trigger button and the drawer itself */
let _setOpen: ((v: boolean) => void) | null = null

/** Call this from anywhere (e.g. chat header) to open the nav drawer */
export function openHamburgerMenu() {
  hapticTap()
  _setOpen?.(true)
}

/** The hamburger trigger button — inline, no fixed positioning */
export function HamburgerTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Open navigation menu"
      onClick={openHamburgerMenu}
      className={cn(
        'flex items-center justify-center size-9 rounded-xl',
        'text-[var(--theme-muted)] hover:text-[var(--theme-muted)] active:scale-90 motion-safe:transition-all motion-safe:duration-150',
        'touch-manipulation select-none',
        className,
      )}
    >
      <HugeiconsIcon icon={Menu01Icon} size={20} strokeWidth={1.8} />
    </button>
  )
}

/** Mount once in WorkspaceShell — renders the drawer + backdrop */
export function MobileHamburgerMenu() {
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(() => isDarkTheme(getTheme()))
  const drawerRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  _setOpen = setOpen

  // Add/remove body class to push main content
  useEffect(() => {
    document.body.classList.toggle('nav-drawer-open', open)
    return () => {
      document.body.classList.remove('nav-drawer-open')
    }
  }, [open])

  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const profileDisplayName = useChatSettingsStore(selectChatProfileDisplayName)
  const echoStudioEnabled = useSettingsStore(
    (state) => state.settings.experimentalEchoStudio,
  )
  const visibleNavItems = MOBILE_HAMBURGER_NAV_ITEMS.filter(
    (item) => item.id !== 'echo-studio' || echoStudioEnabled,
  )
  const isChatRoute =
    pathname.startsWith('/chat') || pathname === '/new' || pathname === '/'

  function handleNav(to: string) {
    hapticTap()
    void navigate({ to, search: {} })
    setOpen(false)
  }

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logoutWorkspace()
    } catch {
      setLoggingOut(false)
    }
  }

  useEffect(() => {
    if (!open) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const focusFrame = window.requestAnimationFrame(() => {
      drawerRef.current
        ?.querySelector<HTMLElement>(
          'button, a, [tabindex]:not([tabindex="-1"])',
        )
        ?.focus()
    })

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        return
      }
      if (e.key !== 'Tab' || !drawerRef.current) return

      const focusable: Array<HTMLElement> = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button, a, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown)
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus()
      }
      previousFocusRef.current = null
    }
  }, [open])

  return (
    <>
      {/* No floating button — each page has MobilePageHeader with HamburgerTrigger inline */}

      {/* Push-style layout wrapper — sidebar pushes content right */}
      <div
        className={cn(
          'fixed inset-0 md:hidden',
          Z_LAYER.navigation,
          'motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-in-out',
          open ? 'translate-x-0' : 'pointer-events-none',
        )}
      >
        {/* Main content overlay — dims and shifts right when sidebar is open */}
        <div
          className={cn(
            'absolute inset-0 bg-black/40 backdrop-blur-[1px] motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-in-out',
            open ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => open && setOpen(false)}
        />
      </div>

      {/* Slide-over drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          'fixed top-0 left-0 bottom-0 w-72 md:hidden',
          Z_LAYER.navigation,
          'shadow-2xl border-r border-[var(--theme-border)] bg-[var(--theme-panel)]',
          'flex flex-col pt-[max(env(safe-area-inset-top,20px),20px)] pb-[max(env(safe-area-inset-bottom,20px),20px)]',
          'motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full pointer-events-none',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-4 border-b border-[var(--theme-border)]">
          <div className="flex items-center gap-2.5">
            <img
              src="/claude-avatar.webp"
              alt="Hermes Workspace logo"
              className="size-8 rounded-xl shrink-0"
            />
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-[15px] tracking-tight text-[var(--theme-text)]">
                Hermes Workspace
              </span>
              <span className="text-[11px] text-[var(--theme-muted)]">
                Workspace
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="flex size-11 items-center justify-center rounded-full text-[var(--theme-muted)] motion-safe:transition-all hover:bg-[var(--theme-hover)] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.8} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 pt-4">
          {visibleNavItems.map((item) => {
            const isActive = item.match(pathname)
            return (
              <a
                key={item.id}
                href={item.to}
                onClick={(event) => {
                  // Preserve browser link affordances such as Cmd/Ctrl-click
                  // and context-menu open-in-new-tab behavior.
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return
                  }
                  event.preventDefault()
                  handleNav(item.to)
                }}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-xl text-left w-full',
                  'motion-safe:transition-all motion-safe:duration-150 hover:bg-[var(--theme-hover)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]',
                )}
                style={
                  isActive
                    ? {
                        background:
                          'var(--theme-accent-subtle, color-mix(in srgb, var(--theme-accent, #6366f1) 12%, transparent))',
                        color:
                          'var(--theme-accent, var(--color-accent, #6366f1))',
                      }
                    : {
                        color:
                          'var(--theme-muted, var(--color-ink-muted, #555))',
                      }
                }
              >
                <HugeiconsIcon
                  icon={item.icon}
                  size={20}
                  strokeWidth={isActive ? 2 : 1.6}
                />
                <span className="text-[15px] font-medium">{item.label}</span>
              </a>
            )
          })}
        </nav>

        {/* Bottom — user profile + settings + theme toggle */}
        <div className="px-3 pb-2 pt-3 border-t border-[var(--theme-border)]">
          <div className="flex items-center gap-3 px-2">
            {/* User avatar + name + status dot */}
            <div
              className="size-9 rounded-xl shrink-0 flex items-center justify-center"
              style={{
                background:
                  'var(--theme-accent-subtle, color-mix(in srgb, var(--theme-accent, #6366f1) 15%, transparent))',
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  color: 'var(--theme-accent, var(--color-accent, #6366f1))',
                }}
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--theme-text)]">
              {profileDisplayName}
            </span>
            <span className="size-2.5 shrink-0 rounded-full bg-[var(--theme-success)]" />

            {/* Settings cog */}
            <button
              type="button"
              onClick={() => handleNav('/settings')}
              className="flex size-11 items-center justify-center rounded-xl text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-hover)] active:bg-[var(--theme-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]"
              aria-label="Settings"
            >
              <HugeiconsIcon
                icon={Settings01Icon}
                size={20}
                strokeWidth={1.5}
              />
            </button>

            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="rounded-xl px-2 py-2 text-xs font-medium text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]"
            >
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>

            {/* Theme toggle — sun/moon */}
            <button
              type="button"
              onClick={() => {
                const current = getTheme()
                const dark = isDarkTheme(current)
                const next = getThemeVariant(current, dark ? 'light' : 'dark')
                setTheme(next)
                setIsDarkMode(isDarkTheme(next))
              }}
              className="flex size-11 items-center justify-center rounded-xl text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-hover)] active:bg-[var(--theme-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]"
              aria-label={
                isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'
              }
              title={
                isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'
              }
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
