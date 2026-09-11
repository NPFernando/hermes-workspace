import { useNavigate, useRouterState } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  BrainIcon,
  ChartCandleIcon,
  Chat01Icon,
  Clock01Icon,
  CommandLineIcon,
  DashboardSquare01Icon,
  File01Icon,
  McpServerIcon,
  PuzzleIcon,
  Settings01Icon,
  Telescope02Icon,
  UserCircle02Icon,
  UserGroupIcon,
  UserMultipleIcon,
  Wallet03Icon,
} from '@hugeicons/core-free-icons'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { TouchEvent } from 'react'
import { cn } from '@/lib/utils'
import { hapticTap } from '@/lib/haptics'
import { useSettings } from '@/hooks/use-settings'

/** Height constant for consistent bottom insets on mobile routes with tab bar */
export const MOBILE_TAB_BAR_OFFSET = 'var(--tabbar-h, 80px)'

/**
 * Z-index layer map (documented for maintainability):
 *   z-40  — tab bar (below everything interactive)
 *   z-50  — chat composer input area
 *   z-60  — quick menus, modal sheets, overlays
 *   z-70  — composer wrapper (fixed on mobile)
 */

type TabItem = {
  id: string
  label: string
  icon: typeof Chat01Icon
  to: string
  match: (path: string) => boolean
}

export const MOBILE_NAV_TABS: Array<TabItem> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: DashboardSquare01Icon,
    to: '/dashboard',
    match: (p) => p === '/dashboard',
  },
  {
    id: 'research',
    label: 'Research',
    icon: Telescope02Icon,
    to: '/research',
    match: (p) => p.startsWith('/research'),
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: Chat01Icon,
    to: '/chat/main',
    match: (p) => p.startsWith('/chat') || p === '/new',
  },
  {
    id: 'files',
    label: 'Files',
    icon: File01Icon,
    to: '/files',
    match: (p) => p.startsWith('/files'),
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: CommandLineIcon,
    to: '/terminal',
    match: (p) => p.startsWith('/terminal'),
  },
  {
    id: 'jobs',
    label: 'Jobs',
    icon: Clock01Icon,
    to: '/jobs',
    match: (p) => p.startsWith('/jobs'),
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: ChartCandleIcon,
    to: '/trading',
    match: (p) => p.startsWith('/trading') || p.startsWith('/finance'),
  },
  {
    id: 'personal-finance',
    label: 'Personal',
    icon: Wallet03Icon,
    to: '/personal-finance',
    match: (p) => p.startsWith('/personal-finance'),
  },
  {
    id: 'swarm',
    label: 'Swarm',
    icon: UserGroupIcon,
    to: '/swarm',
    match: (p) => p === '/swarm' || p.startsWith('/swarm2'),
  },
  {
    id: 'command',
    label: 'Command',
    icon: UserMultipleIcon,
    to: '/command',
    match: (p) =>
      p.startsWith('/command') ||
      p.startsWith('/operations') ||
      p.startsWith('/agents'),
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: BrainIcon,
    to: '/memory',
    match: (p) => p.startsWith('/memory'),
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: PuzzleIcon,
    to: '/skills',
    match: (p) => p.startsWith('/skills'),
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: McpServerIcon,
    to: '/mcp',
    match: (p) => p.startsWith('/mcp'),
  },
  {
    id: 'profiles',
    label: 'Profiles',
    icon: UserCircle02Icon,
    to: '/profiles',
    match: (p) => p.startsWith('/profiles'),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings01Icon,
    to: '/settings',
    match: (p) => p.startsWith('/settings'),
  },
]

export function MobileTabBar() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Drag-to-switch state
  const dragStartXRef = useRef<number | null>(null)
  const dragStartTimeRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const { settings } = useSettings()
  void settings.mobileChatNavMode // reserved for future use
  const isOnChat =
    pathname.startsWith('/chat') || pathname === '/new' || pathname === '/'

  // Always hide tab bar on chat routes — iMessage/Telegram pattern
  const isChatRoute = isOnChat

  // Drag-to-switch: horizontal swipe across pill switches tabs
  const handlePillTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    dragStartXRef.current = event.touches[0].clientX
    dragStartTimeRef.current = Date.now()
    setIsDragging(false)
  }, [])

  const handlePillTouchMove = useCallback((_event: TouchEvent<HTMLElement>) => {
    if (dragStartXRef.current !== null) {
      setIsDragging(true)
    }
  }, [])

  const handlePillTouchEnd = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const startX = dragStartXRef.current
      dragStartXRef.current = null
      setIsDragging(false)

      if (startX === null) return
      const endX = event.changedTouches[0].clientX
      const delta = endX - startX
      const elapsed = Date.now() - (dragStartTimeRef.current ?? Date.now())
      const pillWidth = navRef.current?.getBoundingClientRect().width ?? 200
      // Fast flick (< 250ms) needs less distance, slow drag needs 20% of pill width
      const threshold = elapsed < 250 ? 20 : pillWidth * 0.2

      if (Math.abs(delta) < threshold) return

      const currentIdx = MOBILE_NAV_TABS.findIndex((tab) => tab.match(pathname))
      const nextIdx =
        delta < 0
          ? Math.min(currentIdx + 1, MOBILE_NAV_TABS.length - 1) // swipe left → next tab
          : Math.max(currentIdx - 1, 0) // swipe right → prev tab

      if (
        nextIdx !== currentIdx &&
        nextIdx >= 0 &&
        nextIdx < MOBILE_NAV_TABS.length
      ) {
        hapticTap()
        void navigate({ to: MOBILE_NAV_TABS[nextIdx].to, search: {} })
      }
    },
    [navigate, pathname],
  )

  // Measure pill for --tabbar-h (~80px total = pill + bottom offset)
  useLayoutEffect(() => {
    const root = document.documentElement
    const measure = () => {
      const el = navRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.height <= 0) return
      // pill height + its bottom margin (safe-area + 8px) + 12px breathing room
      const safeArea =
        window.innerHeight - document.documentElement.clientHeight || 0
      const bottomInset = Math.max(safeArea, 16) + 8
      const total = Math.ceil(rect.height) + bottomInset + 12
      root.style.setProperty('--tabbar-h', `${total}px`)
    }

    measure()
    const ro = new ResizeObserver(measure)
    if (navRef.current) ro.observe(navRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Scroll active tab into view when route changes
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const activeBtn = container.querySelector<HTMLElement>(
      '[aria-current="page"]',
    )
    if (activeBtn) {
      const prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      // Do not use scrollIntoView here: the fixed tab bar is still an
      // ancestor of the page in some mobile browsers, so it can scroll the
      // entire dashboard vertically and hide the top toolbar. Move only the
      // tab strip's own horizontal scroll position instead.
      const targetLeft = Math.max(
        0,
        activeBtn.offsetLeft -
          (container.clientWidth - activeBtn.offsetWidth) / 2,
      )
      container.scrollTo({
        left: targetLeft,
        // The dashboard is the first tab. Keeping its initial position
        // deterministic prevents a stale smooth-scroll animation from
        // leaving the active label clipped after a reload or a test gesture.
        behavior:
          pathname === '/dashboard' || prefersReducedMotion ? 'auto' : 'smooth',
      })
    }
  }, [pathname])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const updateScrollAffordance = () => {
      setCanScrollLeft(container.scrollLeft > 4)
      setCanScrollRight(
        container.scrollLeft + container.clientWidth <
          container.scrollWidth - 4,
      )
    }

    updateScrollAffordance()
    container.addEventListener('scroll', updateScrollAffordance, {
      passive: true,
    })
    const resizeObserver = new ResizeObserver(updateScrollAffordance)
    resizeObserver.observe(container)
    return () => {
      container.removeEventListener('scroll', updateScrollAffordance)
      resizeObserver.disconnect()
    }
  }, [isChatRoute])

  // Keep --tabbar-h fresh when tab bar hides/shows
  useEffect(() => {
    const root = document.documentElement
    if (isChatRoute) {
      // Tab bar hidden in chat routes — remove extra padding
      root.style.setProperty('--tabbar-h', '0px')
    } else {
      // Restore measured value on next paint
      const el = navRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        if (rect.height > 0) {
          const safeArea2 =
            window.innerHeight - document.documentElement.clientHeight || 0
          const bInset = Math.max(safeArea2, 16) + 8
          root.style.setProperty(
            '--tabbar-h',
            `${Math.ceil(rect.height) + bInset + 12}px`,
          )
        }
      }
    }
  }, [isChatRoute])

  return (
    <>
      <nav
        ref={navRef}
        className={cn(
          // Pill: fixed bottom center, capped to screen width so tabs don't overflow
          'fixed bottom-0 left-0 right-0 mx-auto z-[80] md:hidden',
          'max-w-[calc(100vw-24px)]',
          // Vertical position: above home indicator
          'mb-[max(env(safe-area-inset-bottom,8px),16px)]',
          // Keep the pill visually isolated from page and error-state backgrounds
          'bg-[var(--theme-panel)] shadow-lg backdrop-blur supports-[backdrop-filter]:bg-[var(--theme-panel)]',
          'rounded-full overflow-hidden',
          'border border-[var(--theme-border)]',
          // Vertical padding only; horizontal padding lives on the scroll container
          'py-2',
          // Hide/show animation
          'motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-in-out',
          isChatRoute
            ? 'translate-y-[200%] opacity-0 pointer-events-none'
            : 'translate-y-0 opacity-100',
          isDragging ? 'cursor-grabbing' : '',
        )}
        aria-label="Mobile navigation"
        onTouchStart={handlePillTouchStart}
        onTouchMove={handlePillTouchMove}
        onTouchEnd={handlePillTouchEnd}
      >
        <div
          ref={scrollRef}
          className="flex touch-pan-x items-center gap-0.5 overflow-x-auto overscroll-x-contain scrollbar-none px-2"
        >
          {MOBILE_NAV_TABS.map((tab) => {
            const isActive = tab.match(pathname)
            const isCenter = tab.id === 'chat'
            const circleSize =
              isCenter && isActive ? 'size-10' : isActive ? 'size-9' : 'size-10'

            return (
              <a
                key={tab.id}
                href={tab.to}
                title={isActive ? `${tab.label} (current page)` : tab.label}
                onClick={(event) => {
                  // Preserve browser link affordances such as Cmd/Ctrl-click
                  // and prevent a drag gesture from becoming a route change.
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
                  if (isDragging) return
                  hapticTap()
                  void navigate({ to: tab.to, search: {} })
                }}
                aria-current={isActive ? 'page' : undefined}
                aria-label={
                  isActive ? `${tab.label} (current page)` : tab.label
                }
                className={cn(
                  // Keep a 40px touch target; the active item grows just
                  // enough to expose its label and improve orientation.
                  'flex shrink-0 items-center justify-center',
                  'h-10 min-w-10 rounded-full',
                  isActive ? 'px-1' : 'w-10',
                  'motion-safe:transition-all motion-safe:duration-200 active:scale-90',
                  'select-none touch-manipulation',
                  'outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)]',
                )}
              >
                <span
                  className={cn(
                    'flex items-center justify-center rounded-full motion-safe:transition-all motion-safe:duration-200',
                    isActive ? 'h-9 min-w-9 gap-1 px-2' : circleSize,
                    isActive
                      ? 'bg-accent-500 text-[var(--theme-bg)] shadow-sm'
                      : 'text-[var(--theme-muted)]',
                  )}
                >
                  <HugeiconsIcon
                    icon={tab.icon}
                    size={isCenter ? 20 : 18}
                    strokeWidth={isActive ? 2 : 1.6}
                  />
                  {isActive ? (
                    <span className="text-[9px] font-semibold uppercase tracking-[0.08em]">
                      {tab.label}
                    </span>
                  ) : null}
                </span>
              </a>
            )
          })}
        </div>
        {canScrollLeft && !isChatRoute ? (
          <span
            aria-hidden="true"
            data-testid="mobile-nav-scroll-left"
            className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-start rounded-l-full bg-gradient-to-r from-[var(--theme-panel)] via-[var(--theme-panel)]/90 to-transparent pl-1 text-sm text-[var(--theme-accent)]"
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={16}
              strokeWidth={1.8}
              className="rotate-180"
            />
          </span>
        ) : null}
        {canScrollRight && !isChatRoute ? (
          <span
            aria-hidden="true"
            data-testid="mobile-nav-scroll-right"
            className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end rounded-r-full bg-gradient-to-l from-[var(--theme-panel)] via-[var(--theme-panel)]/90 to-transparent pr-1 text-sm text-[var(--theme-accent)]"
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={16}
              strokeWidth={1.8}
            />
          </span>
        ) : null}
      </nav>
    </>
  )
}
