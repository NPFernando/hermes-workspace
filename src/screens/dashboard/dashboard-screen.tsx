import {
  BubbleChatAddIcon,
  CheckmarkCircle02Icon,
  ConsoleIcon,
  Edit02Icon,
  Moon02Icon,
  PuzzleIcon,
  Refresh01Icon,
  Settings02Icon,
  Sun02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { AchievementsCard } from './components/achievements-card'
import { ActiveModelKpi } from './components/active-model-kpi'
import { AttentionMarquee } from './components/attention-marquee'
import { CacheEfficiencyCard } from './components/cache-efficiency-card'
import { CostLedgerCard } from './components/cost-ledger-card'
import { EditModePanel } from './components/edit-mode-panel'
import { FinanceOverviewCard } from './components/finance-overview-card'
import { HeroMetrics } from './components/hero-metrics'
import { LogsTailCard } from './components/logs-tail-card'
import { OperatorTipCard } from './components/operator-tip-card'
import { ProactiveSuggestionsCard } from './components/proactive-suggestions-card'
import { OpsStrip } from './components/ops-strip'
import { ProviderMixCard } from './components/provider-mix-card'
import { SessionsIntelligenceCard } from './components/sessions-intelligence-card'
import { SkillsUsageCard } from './components/skills-usage-card'
import { TokenMixHourCard } from './components/token-mix-hour-card'
import { TopModelsCard } from './components/top-models-card'
import { TradingOverviewCard } from './components/trading-overview-card'
import { VelocityCard } from './components/velocity-card'
import { WidgetShell } from './components/widget-shell'
import { DashboardRefreshProvider } from './lib/dashboard-refresh-context'
import { normalizeDashboardSessionsPayload } from './lib/sessions-query'
import { useDashboardLayout } from './lib/use-dashboard-layout'
import type { SessionRowData } from './components/sessions-intelligence-card'
import type { AnalyticsPeriod } from './components/analytics-chart-card'
import type { ReactNode } from 'react'
import type { ClaudeSession } from '@/server/claude-api'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { cn } from '@/lib/utils'
import { applyTheme, useSettingsStore } from '@/hooks/use-settings'
import { openHamburgerMenu } from '@/components/mobile-hamburger-menu'
import { useFeatureAvailable } from '@/hooks/use-feature-available'
import { getTheme, getThemeVariant, isDarkTheme, setTheme } from '@/lib/theme'

const AnalyticsChartCard = lazy(() =>
  import('./components/analytics-chart-card').then((m) => ({
    default: m.AnalyticsChartCard,
  })),
)

// `IconSvgObject` isn't exported from @hugeicons/react; reuse the
// inferred type from a real icon import for prop typing.
type HugeIcon = typeof Settings02Icon

// ── Helpers ──────────────────────────────────────────────────────

function formatSyncTime(timestamp: number): string {
  if (!timestamp) return 'not yet synced'
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatSyncAge(timestamp: number): string {
  if (!timestamp) return 'not yet synced'
  const ageMinutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000))
  if (ageMinutes < 60) return `${ageMinutes}m ago`
  const ageHours = Math.round(ageMinutes / 60)
  if (ageHours < 24) return `${ageHours}h ago`
  return `${Math.round(ageHours / 24)}d ago`
}

function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

function readDashboardPalette() {
  return {
    accent: themeColor('--theme-accent', '#6366f1'),
    accentSecondary: themeColor('--theme-accent-secondary', '#8b5cf6'),
    success: themeColor('--theme-success', '#22c55e'),
    warning: themeColor('--theme-warning', '#f59e0b'),
    danger: themeColor('--theme-danger', '#ef4444'),
    muted: themeColor('--theme-muted', '#6b7280'),
    border: themeColor('--theme-border', '#333333'),
    card: themeColor('--theme-card', '#1a1a2e'),
    text: themeColor('--theme-text', '#e5e7eb'),
  }
}

function useDashboardPalette() {
  const [palette, setPalette] = useState(readDashboardPalette)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const refresh = () => setPalette(readDashboardPalette())
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    })
    return () => observer.disconnect()
  }, [])

  return palette
}

// ── Glass Card ───────────────────────────────────────────────────

function GlassCard({
  title,
  titleRight,
  accentColor,
  noPadding,
  className,
  children,
}: {
  title?: string
  titleRight?: ReactNode
  accentColor?: string
  noPadding?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'surface-card card-glow relative flex flex-col overflow-hidden rounded-xl border motion-safe:transition-colors bg-[var(--theme-card)] border-[var(--theme-border)]',
        className,
      )}
    >
      {accentColor && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
          style={{
            background: `linear-gradient(90deg, ${accentColor}, ${accentColor}50, transparent)`,
          }}
        />
      )}
      {title && (
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            {title}
          </h2>
          {titleRight}
        </div>
      )}
      <div className={cn('flex-1', noPadding ? '' : 'px-5 pb-4 pt-3')}>
        {children}
      </div>
    </div>
  )
}

function EnhancedBadge({ label = 'Enhanced API' }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
      style={{
        border: `1px solid ${themeColor('--theme-accent-border', 'rgba(245, 158, 11, 0.28)')}`,
        background: themeColor(
          '--theme-accent-subtle',
          'rgba(245, 158, 11, 0.12)',
        ),
        color: themeColor('--theme-accent', '#f59e0b'),
      }}
    >
      {label}
    </span>
  )
}

function UnavailableWidget({
  title,
  description,
  actionLabel,
  onAction,
  actionBusy = false,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  actionBusy?: boolean
}) {
  return (
    <GlassCard
      title={title}
      titleRight={<EnhancedBadge label="Unavailable" />}
      accentColor={themeColor('--theme-warning', '#f59e0b')}
      className="h-full"
    >
      <div className="flex h-full min-h-[180px] items-center justify-center rounded-lg border border-dashed border-[var(--theme-border)] bg-[var(--theme-card2)] px-4 text-center">
        <div className="flex max-w-md flex-col items-center gap-3">
          <p className="text-sm text-[var(--theme-muted)]">{description}</p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              disabled={actionBusy}
              aria-busy={actionBusy ? 'true' : undefined}
              className="inline-flex min-h-11 items-center justify-center rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] disabled:cursor-wait disabled:opacity-60"
              style={{ borderColor: 'var(--theme-accent-border)' }}
            >
              {actionBusy ? 'Retrying…' : actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </GlassCard>
  )
}

// ── Secondary action (smaller, monochrome) ─────────────────────

function CompactActionHint({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <span className="group/action-hint relative inline-flex">
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 py-1 text-[10px] font-medium normal-case tracking-normal text-[var(--theme-text)] opacity-0 shadow-lg transition-opacity group-hover/action-hint:opacity-100 group-focus-within/action-hint:opacity-100 max-[399px]:block"
      >
        {label}
      </span>
    </span>
  )
}

function SecondaryAction({
  label,
  icon,
  to,
  onClick,
  disabled,
  title,
}: {
  label: string
  icon: HugeIcon
  to?: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  const className =
    'group inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] motion-safe:transition-all motion-safe:hover:scale-[1.015] hover:bg-[var(--theme-card)]/70 hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)] motion-safe:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 max-[399px]:min-w-11 max-[399px]:justify-center sm:px-3 sm:text-xs lg:min-h-10'
  const style = {
    borderColor: 'var(--theme-border)',
    color: 'var(--theme-muted)',
    background:
      'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 80%, transparent), transparent)',
  }
  const content = (
    <>
      <HugeiconsIcon
        icon={icon}
        size={14}
        strokeWidth={1.6}
        className="motion-safe:transition-colors group-hover:text-[var(--theme-accent)]"
      />
      <span className="max-[399px]:hidden">{label}</span>
    </>
  )

  return (
    <CompactActionHint label={label}>
      {to && !disabled ? (
        <Link
          to={to as never}
          aria-label={label}
          title={title || label}
          className={className}
          style={style}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          title={title || label}
          className={className}
          style={style}
        >
          {content}
        </button>
      )}
    </CompactActionHint>
  )
}

// ── Main Dashboard ───────────────────────────────────────────────

export function DashboardScreen() {
  const navigate = useNavigate()
  const skillsAvailable = useFeatureAvailable('skills')
  const sessionsQuery = useQuery({
    // Use a dedicated query key — NOT chatQueryKeys.sessions — to avoid
    // cache collisions with the chat sidebar which fetches fewer sessions
    // and overwrites the dashboard's larger dataset.
    // Also use the workspace proxy (/api/sessions) rather than the server-side
    // listSessions() — the latter calls the gateway via CLAUDE_API which is
    // only available server-side and returns nothing when called from the client.
    // Do not gate this direct proof behind /api/gateway-status. That probe can
    // be stale/loading while /api/sessions already works, which made the
    // dashboard show a bogus “Enhanced API required” warning even though
    // sessions were healthy.
    queryKey: ['dashboard', 'sessions'],
    queryFn: async () => {
      const controller = new AbortController()
      const timeout = globalThis.setTimeout(() => controller.abort(), 5_000)
      try {
        const res = await fetch('/api/sessions?limit=200&offset=0', {
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Sessions API returned HTTP ${res.status}`)
        }
        const data = await res.json()
        return normalizeDashboardSessionsPayload(data)
      } finally {
        globalThis.clearTimeout(timeout)
      }
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    // Sessions are a primary dashboard surface, but a failed request should
    // resolve to the card's explicit unavailable/retry state immediately.
    // Waiting through another retry leaves the operator staring at a stale
    // loading skeleton after the rest of telemetry has already failed.
    retry: 0,
  })

  const sessionsResult = sessionsQuery.data

  // Raw rows from the sessions endpoint. Used both for hero stats
  // (count/tokens) and for the SessionsIntelligenceCard below.
  const rawSessions = sessionsResult?.sessions ?? []
  const sessionsUnavailable = Boolean(sessionsResult?.unavailable)
  const sessionsUnavailableMessage =
    'Session history is temporarily unavailable. Retry to reconnect it, or start a new chat from the dashboard.'

  // Adapter shape kept for the legacy fallbacks that still reference
  // ClaudeSession (HeroMetrics fallback path, etc.).
  const sessions = useMemo(
    () =>
      rawSessions.map((s) => ({
        id: (s.key ?? s.id) as string,
        started_at: s.startedAt ? (s.startedAt as number) / 1000 : undefined,
        message_count: (s.message_count as number | undefined) ?? 0,
        tool_call_count: (s.tool_call_count as number | undefined) ?? 0,
        input_tokens: (s.tokenCount as number | undefined) ?? 0,
        output_tokens: 0,
      })) as Array<ClaudeSession>,
    [rawSessions],
  )

  // Enriched rows for the Sessions Intelligence card. Keeps the rich
  // fields (`derivedTitle`, `kind`, `status`, `source`, `updatedAt`,
  // etc.) the legacy adapter dropped.
  const sessionRows: Array<SessionRowData> = useMemo(
    () =>
      [...rawSessions]
        .sort(
          (a, b) =>
            ((b.updatedAt as number | undefined) ??
              (b.startedAt as number | undefined) ??
              0) -
            ((a.updatedAt as number | undefined) ??
              (a.startedAt as number | undefined) ??
              0),
        )
        .slice(0, 12)
        .map((s) => ({
          key: String(s.key ?? s.id ?? ''),
          title:
            (s.derivedTitle as string | undefined) ||
            (s.title as string | undefined) ||
            (s.preview as string | undefined) ||
            String(s.key ?? ''),
          kind: String(s.kind ?? 'chat'),
          status: String(s.status ?? ''),
          source: (s.source as string | undefined) ?? null,
          model: (s.model as string | undefined) ?? null,
          messageCount:
            (s.messageCount as number | undefined) ??
            (s.message_count as number | undefined) ??
            0,
          toolCallCount:
            (s.toolCallCount as number | undefined) ??
            (s.tool_call_count as number | undefined) ??
            0,
          tokenCount:
            (s.tokenCount as number | undefined) ??
            (s.totalTokens as number | undefined) ??
            0,
          startedAt: (s.startedAt as number | undefined) ?? null,
          updatedAt: (s.updatedAt as number | undefined) ?? null,
        })),
    [rawSessions],
  )

  const stats = useMemo(() => {
    let totalMessages = 0,
      totalToolCalls = 0,
      totalTokens = 0
    for (const s of sessions) {
      totalMessages += s.message_count ?? 0
      totalToolCalls += s.tool_call_count ?? 0
      totalTokens += (s.input_tokens ?? 0) + (s.output_tokens ?? 0)
    }
    return {
      totalSessions: sessions.length,
      totalMessages,
      totalToolCalls,
      totalTokens,
    }
  }, [sessions])

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))
        .slice(0, 6),
    [sessions],
  )

  const maxTokens = useMemo(() => {
    let max = 0
    for (const s of recentSessions) {
      const t = (s.input_tokens ?? 0) + (s.output_tokens ?? 0)
      if (t > max) max = t
    }
    return max
  }, [recentSessions])

  // Skills count for the SkillsUsageCard sub-text. Cheap query, used
  // only for the "X of Y used" microcopy.
  const skillsCountQuery = useQuery({
    queryKey: ['dashboard', 'skills-count'],
    queryFn: async () => {
      const controller = new AbortController()
      const timeout = globalThis.setTimeout(() => controller.abort(), 5_000)
      try {
        const res = await fetch(
          '/api/skills?tab=installed&limit=200&summary=search',
          { signal: controller.signal },
        )
        // Throw on failure so react-query retries and the card can tell
        // "count unknown" apart from a real zero — returning 0 here caches
        // a transient failure as "no skills installed" for staleTime.
        if (!res.ok) throw new Error(`skills count failed (${res.status})`)
        const data = (await res.json()) as {
          skills?: Array<unknown>
        }
        return data.skills?.length ?? 0
      } finally {
        globalThis.clearTimeout(timeout)
      }
    },
    staleTime: 60_000,
    enabled: skillsAvailable,
    retry: 1,
    retryDelay: 1_000,
  })
  const skillsInstalled = skillsCountQuery.data ?? null

  // Per-user widget visibility + edit-mode state (localStorage backed).
  const layout = useDashboardLayout()
  const editToggleRef = useRef<HTMLButtonElement>(null)
  const wasEditingRef = useRef(layout.editMode)
  useEffect(() => {
    const wasEditing = wasEditingRef.current
    wasEditingRef.current = layout.editMode
    if (layout.editMode && !wasEditing) {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>('#dashboard-layout-controls button')
          ?.focus()
      })
    } else if (!layout.editMode && wasEditing) {
      requestAnimationFrame(() => editToggleRef.current?.focus())
    }
  }, [layout.editMode])
  const hasLowerMainWidgets =
    layout.isVisible('operator_tip') ||
    layout.isVisible('proactive_suggestions') ||
    layout.isVisible('sessions_intelligence') ||
    layout.isVisible('logs_tail')
  const hasLowerRailWidgets =
    layout.isVisible('achievements') ||
    layout.isVisible('skills_usage') ||
    layout.isVisible('mix_rhythm')

  // Period selector for analytics; persists across navigation via
  // localStorage so refreshes don't reset the operator's preference.
  const [period, setPeriod] = useState<AnalyticsPeriod>(() => {
    if (typeof window === 'undefined') return 30
    try {
      const stored = window.localStorage.getItem('dashboard.analyticsPeriod')
      const n = Number(stored)
      if (n === 7 || n === 14 || n === 30) return n
    } catch {
      // Restricted storage should not prevent the dashboard from rendering.
    }
    return 30
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('dashboard.analyticsPeriod', String(period))
      } catch {
        // Preference persistence is best-effort; the live selection still works.
      }
    }
  }, [period])

  // Aggregate dashboard overview — surfaces the data the native
  // Hermes dashboard exposes (status, platforms, cron, achievements,
  // model info, analytics) in a single round trip with per-section
  // graceful fallbacks. Each card renders only when its slice resolves.
  const overviewQuery = useQuery<DashboardOverview>({
    queryKey: ['dashboard', 'overview', period],
    // Switching 7d/14d/30d should not blank the entire dashboard while the
    // new aggregate window is fetched. Keep the last coherent snapshot in
    // place and let the status line/cards expose the background refresh.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // achievements=5 (instead of 3) gives the Achievements rail
      // card enough vertical mass to fill the gap below Top Models.
      const controller = new AbortController()
      const timeout = globalThis.setTimeout(() => controller.abort(), 8_000)
      try {
        const res = await fetch(
          `/api/dashboard/overview?days=${period}&achievements=5`,
          { signal: controller.signal },
        )
        if (!res.ok) throw new Error(`overview ${res.status}`)
        return (await res.json()) as DashboardOverview
      } finally {
        globalThis.clearTimeout(timeout)
      }
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
    // The aggregate endpoint fans out to several services. A second
    // automatic timeout would hold the entire first viewport in a loading
    // state for ~17s; surface the recovery action after one bounded attempt.
    retry: 0,
  })
  const overview = overviewQuery.data ?? null
  const analyticsUnavailable = overview?.analytics?.source === 'unavailable'
  const overviewIsStale =
    overviewQuery.dataUpdatedAt > 0 &&
    Date.now() - overviewQuery.dataUpdatedAt > 90_000
  const overviewStatusLabel = overviewQuery.isError
    ? 'Telemetry needs attention'
    : overviewQuery.isLoading
      ? 'Syncing telemetry'
      : overviewQuery.isFetching
        ? 'Refreshing telemetry…'
        : overviewIsStale
          ? `Stale · ${formatSyncAge(overviewQuery.dataUpdatedAt)}`
          : `Live · updated ${formatSyncTime(overviewQuery.dataUpdatedAt)}`

  const queryClient = useQueryClient()
  const [manualRefreshPending, setManualRefreshPending] = useState(false)
  const [refreshAnnouncement, setRefreshAnnouncement] = useState('')
  const refreshDashboard = async () => {
    setManualRefreshPending(true)
    setRefreshAnnouncement('Refreshing dashboard data.')
    const releaseBusyState = setTimeout(() => {
      setManualRefreshPending(false)
    }, 4_000)
    try {
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setRefreshAnnouncement('Dashboard data refreshed.')
    } catch {
      setRefreshAnnouncement(
        'Dashboard refresh failed. Use Retry sync to try again.',
      )
    } finally {
      clearTimeout(releaseBusyState)
      setManualRefreshPending(false)
    }
  }

  const palette = useDashboardPalette()

  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return true
    const dt = document.documentElement.getAttribute('data-theme') || ''
    return !dt.endsWith('-light')
  })

  // Keep the compact mobile theme control synchronized with theme changes
  // made from Settings or another part of the shell. Without this observer
  // the icon/label can describe the previous theme until the dashboard is
  // remounted.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const root = document.documentElement
    const syncThemeState = () => {
      const theme = root.getAttribute('data-theme') || ''
      setIsDark(!theme.endsWith('-light'))
    }
    syncThemeState()
    const observer = new MutationObserver(syncThemeState)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return (
    <DashboardRefreshProvider
      refresh={() => void refreshDashboard()}
      isRefreshing={manualRefreshPending}
      globalUnavailable={overviewQuery.isError}
    >
      <div
        id="dashboard-content"
        tabIndex={-1}
        data-route-page
        aria-busy={
          manualRefreshPending ||
          overviewQuery.isLoading ||
          sessionsQuery.isLoading
            ? 'true'
            : undefined
        }
        className="min-h-full"
      >
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {refreshAnnouncement}
        </p>
        {/* Floating mobile nav: hamburger left, theme toggle right */}
        <div
          className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between border-b border-[var(--theme-border)]/50 bg-[var(--theme-bg)]/80 px-2 backdrop-blur-md md:hidden"
          style={{
            height: 'calc(3rem + env(safe-area-inset-top, 0px))',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={openHamburgerMenu}
            className="flex h-11 w-11 items-center justify-center rounded-xl motion-safe:transition-colors active:bg-[var(--theme-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)] touch-manipulation"
          >
            <svg
              width="20"
              height="16"
              viewBox="0 0 20 16"
              fill="none"
              className="opacity-70"
              style={{ color: 'var(--theme-text)' }}
            >
              <path
                d="M1 1.5H19M1 8H19M1 14.5H13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label={
              isDark ? 'Switch to light theme' : 'Switch to dark theme'
            }
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => {
              const currentTheme = getTheme()
              const nextMode = isDark ? 'light' : 'dark'
              const nextDataTheme = getThemeVariant(currentTheme, nextMode)
              const appliedMode = isDarkTheme(nextDataTheme) ? 'dark' : 'light'
              setTheme(nextDataTheme)
              applyTheme(appliedMode)
              updateSettings({ theme: appliedMode })
              setIsDark(isDarkTheme(nextDataTheme))
            }}
            className="flex h-11 w-11 items-center justify-center rounded-xl motion-safe:transition-colors active:bg-[var(--theme-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)] touch-manipulation text-[var(--theme-muted)]"
          >
            <HugeiconsIcon
              icon={isDark ? Sun02Icon : Moon02Icon}
              size={20}
              strokeWidth={1.5}
            />
          </button>
        </div>
        <div className="space-y-5 px-4 pb-[calc(var(--tabbar-h,80px)+6rem)] pt-[calc(3.5rem+env(safe-area-inset-top,0px))] md:px-8 md:py-6 md:pt-4 md:pb-28 lg:px-10">
          {/* ── Header: brand lockup left, action cluster right.
           Iteration 010: dropped redundant "Dashboard" eyebrow (the
           page IS the dashboard); promoted "Hermes Workspace" to
           the primary heading at a larger weight. Logo bumped from
           36px → 44px and gets a soft accent glow + ring so the
           lockup commands the left side instead of feeling like
           filler before the action cluster. Kept anchored left
           (not centered) on purpose: ops dashboards put brand left
           + actions right because that's the spatial hierarchy
           operators expect (Linear, Vercel, Datadog all do this). */}
          <div className="flex flex-col gap-3 lg:pr-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span
                className="relative inline-flex shrink-0 items-center justify-center rounded-xl border"
                style={{
                  width: 44,
                  height: 44,
                  borderColor:
                    'color-mix(in srgb, var(--theme-accent) 35%, var(--theme-border))',
                  background:
                    'linear-gradient(135deg, color-mix(in srgb, var(--theme-accent) 14%, var(--theme-card)), var(--theme-card))',
                  boxShadow:
                    '0 0 0 4px color-mix(in srgb, var(--theme-accent) 6%, transparent)',
                }}
              >
                <img
                  src="/claude-avatar.webp"
                  alt="Hermes Workspace logo"
                  className="size-8 rounded-md"
                  style={{ background: 'transparent' }}
                />
              </span>
              {/* Iter 011: dropped the 'Operator console · vX.Y.Z'
              eyebrow. The gateway version is already on the OpsStrip
              (♦ GATEWAY V0.12.0), so the eyebrow was duplicating it.
              Single bold lockup feels cleaner; vertical centering on
              the lockup matches the height of the action cluster on
              the right so they don't visually drift. */}
              <div className="flex min-w-0 flex-col justify-center">
                <h1
                  className="text-2xl font-bold tracking-tight"
                  style={{
                    color: 'var(--theme-text)',
                    letterSpacing: '-0.015em',
                    lineHeight: 1.1,
                  }}
                >
                  Hermes Workspace
                </h1>
                <p
                  aria-live="polite"
                  aria-atomic="true"
                  className={cn(
                    'mt-1 min-w-0 max-w-[22rem] truncate whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.16em] lg:max-w-none',
                    overviewIsStale
                      ? 'text-[var(--theme-warning)]'
                      : 'text-[var(--theme-muted)]',
                  )}
                >
                  {overviewStatusLabel}
                  <span className="hidden sm:inline">
                    {' '}
                    · refreshes every 30s
                  </span>
                </p>
              </div>
            </div>
            {/* Action row: hierarchy per Hermes Agent review.
           New Chat is primary (full button + accent), Terminal +
           Skills are secondary, Settings collapses to icon-only. */}
            <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto sm:flex-nowrap sm:justify-end lg:max-w-none">
              <Link
                to="/chat/$sessionKey"
                params={{ sessionKey: 'new' }}
                className="group relative inline-flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.05em] whitespace-nowrap motion-safe:transition-all motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)] sm:w-auto sm:px-3.5 sm:py-2 sm:text-sm"
                style={{
                  background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentSecondary})`,
                  color: 'var(--theme-on-accent, white)',
                  boxShadow: `0 6px 18px -8px ${palette.accent}aa, inset 0 1px 0 0 rgba(255,255,255,0.18)`,
                }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 motion-safe:transition-opacity group-hover:opacity-100"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(255,255,255,0.15), transparent 60%)',
                  }}
                />
                <HugeiconsIcon
                  icon={BubbleChatAddIcon}
                  size={16}
                  strokeWidth={1.8}
                />
                <span>New Chat</span>
              </Link>
              <SecondaryAction
                label="Terminal"
                icon={ConsoleIcon}
                to="/terminal"
                onClick={() => navigate({ to: '/terminal' })}
              />
              <SecondaryAction
                label="Skills"
                icon={PuzzleIcon}
                to="/skills"
                onClick={() => navigate({ to: '/skills' })}
                disabled={!skillsAvailable}
                title={
                  skillsAvailable
                    ? undefined
                    : 'Skills are temporarily unavailable. Connect the gateway to enable them.'
                }
              />
              <CompactActionHint
                label={
                  manualRefreshPending
                    ? 'Refreshing dashboard'
                    : 'Refresh dashboard'
                }
              >
                <button
                  type="button"
                  aria-label={
                    manualRefreshPending
                      ? 'Refreshing dashboard'
                      : 'Refresh dashboard'
                  }
                  title={
                    manualRefreshPending
                      ? 'Refreshing dashboard…'
                      : 'Refresh dashboard'
                  }
                  aria-busy={manualRefreshPending ? 'true' : undefined}
                  onClick={() => void refreshDashboard()}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border motion-safe:transition-all motion-safe:hover:scale-[1.05] hover:bg-[var(--theme-card)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)] disabled:cursor-wait disabled:opacity-70 lg:size-9"
                  style={{
                    borderColor: 'var(--theme-border)',
                    color: manualRefreshPending
                      ? 'var(--theme-accent)'
                      : 'var(--theme-muted)',
                    background:
                      'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 80%, transparent), transparent)',
                  }}
                  disabled={manualRefreshPending}
                >
                  <HugeiconsIcon
                    icon={Refresh01Icon}
                    size={15}
                    strokeWidth={1.7}
                    className={
                      manualRefreshPending
                        ? 'motion-safe:animate-spin'
                        : undefined
                    }
                  />
                </button>
              </CompactActionHint>
              {/* Edit toggle: enters "layout edit mode" where each widget
              shows an X button and a banner appears for re-adding
              hidden widgets. Persisted to localStorage. */}
              <CompactActionHint
                label={layout.editMode ? 'Done editing layout' : 'Edit layout'}
              >
                <button
                  type="button"
                  ref={editToggleRef}
                  aria-label={
                    layout.editMode ? 'Done editing layout' : 'Edit layout'
                  }
                  aria-keyshortcuts={layout.editMode ? 'Escape' : undefined}
                  aria-expanded={layout.editMode}
                  aria-controls={
                    layout.editMode ? 'dashboard-layout-controls' : undefined
                  }
                  title={
                    layout.editMode
                      ? 'Done editing layout (Escape)'
                      : 'Edit layout'
                  }
                  onClick={layout.toggleEdit}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border motion-safe:transition-all motion-safe:hover:scale-[1.05] hover:bg-[var(--theme-card)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)] lg:size-9"
                  style={{
                    borderColor: layout.editMode
                      ? 'var(--theme-accent)'
                      : 'var(--theme-border)',
                    background: layout.editMode
                      ? 'color-mix(in srgb, var(--theme-accent) 14%, transparent)'
                      : 'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 80%, transparent), transparent)',
                    color: layout.editMode
                      ? 'var(--theme-accent)'
                      : 'var(--theme-muted)',
                  }}
                >
                  <HugeiconsIcon
                    icon={layout.editMode ? CheckmarkCircle02Icon : Edit02Icon}
                    size={15}
                    strokeWidth={1.7}
                  />
                </button>
              </CompactActionHint>
              <CompactActionHint label="Settings">
                <Link
                  to="/settings"
                  search={{}}
                  aria-label="Settings"
                  title="Settings"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border motion-safe:transition-all motion-safe:hover:scale-[1.05] hover:bg-[var(--theme-card)]/70 hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)] lg:size-9"
                  style={{
                    borderColor: 'var(--theme-border)',
                    color: 'var(--theme-muted)',
                    background:
                      'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 80%, transparent), transparent)',
                  }}
                >
                  <HugeiconsIcon
                    icon={Settings02Icon}
                    size={15}
                    strokeWidth={1.7}
                  />
                </Link>
              </CompactActionHint>
            </div>
          </div>

          {overviewQuery.isError ? (
            <div
              data-testid="dashboard-degraded-banner"
              role="status"
              className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-20 flex flex-col gap-3 rounded-xl border px-4 py-3 backdrop-blur-md md:top-2 sm:flex-row sm:items-center sm:justify-between"
              style={{
                borderColor:
                  'color-mix(in srgb, var(--theme-warning) 30%, transparent)',
                background:
                  'color-mix(in srgb, var(--theme-card) 97%, var(--theme-warning) 3%)',
                boxShadow:
                  '0 8px 24px color-mix(in srgb, var(--theme-bg) 28%, transparent)',
              }}
            >
              <div className="flex items-start gap-3">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--theme-warning)]" />
                <div>
                  <p className="text-xs font-semibold text-[var(--theme-text)]">
                    Live overview is temporarily unavailable
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--theme-muted)]">
                    The workspace is still usable. Retry to refresh gateway,
                    analytics, and operations data.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <button
                  type="button"
                  onClick={() => void refreshDashboard()}
                  disabled={manualRefreshPending}
                  aria-busy={manualRefreshPending ? 'true' : undefined}
                  aria-label={
                    manualRefreshPending
                      ? 'Retrying dashboard telemetry'
                      : 'Retry dashboard telemetry'
                  }
                  className="min-h-11 rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-warning)] motion-safe:transition-colors hover:bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-warning)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] disabled:cursor-wait disabled:opacity-60 lg:min-h-9"
                  style={{
                    borderColor:
                      'color-mix(in srgb, var(--theme-warning) 35%, transparent)',
                  }}
                >
                  {manualRefreshPending ? 'Retrying…' : 'Retry sync'}
                </button>
                <Link
                  to="/conductor"
                  className="min-h-11 rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[color-mix(in_srgb,var(--theme-accent)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-9"
                  style={{
                    minHeight: '2.75rem',
                    borderColor:
                      'color-mix(in srgb, var(--theme-accent) 35%, transparent)',
                  }}
                >
                  Connect gateway
                </Link>
              </div>
            </div>
          ) : null}

          {overviewQuery.isLoading ? (
            <div
              role="status"
              aria-live="polite"
              aria-label="Syncing workspace telemetry. Gateway, analytics, and operational summaries are loading."
              className="flex items-center gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)]/55 px-4 py-2.5 text-[11px] text-[var(--theme-muted)]"
            >
              <span
                className="size-2 rounded-full bg-[var(--theme-accent)] motion-safe:animate-pulse"
                aria-hidden
              />
              <span className="shrink-0 whitespace-nowrap font-medium text-[var(--theme-text)]">
                Syncing workspace telemetry
              </span>
              <span className="hidden min-w-0 truncate sm:inline">
                Gateway, analytics, and operational summaries are loading.
              </span>
            </div>
          ) : null}

          {/* Keep layout controls next to the header so edit mode is
            immediately actionable without scrolling past widgets. */}
          <EditModePanel layout={layout} />

          {/* ── Attention marquee ──
           Iteration 008: lifted *out* of the OpsStrip into its own
           dedicated row above it. Fixed Eric's 'feels cluttered'
           concern by giving the ticker its own visual chamber
           (warning gradient, separated border) so it doesn't blend
           into the gateway/version/cron line below it. */}
          {(overview?.incidents.length ?? 0) > 0 ? (
            <AttentionMarquee overview={overview ?? null} />
          ) : null}

          {/* ── Ops strip (gateway + version drift + platforms + cron pulse). ── */}
          {!overviewQuery.isError ? (
            <OpsStrip
              status={overview?.status ?? null}
              cron={overview?.cron ?? null}
              kanban={overview?.kanban ?? null}
              platforms={overview?.platforms ?? []}
              unavailable={false}
            />
          ) : null}

          {/* ── Hero Metrics: 3 analytics tiles + Active Model KPI in slot 4 ── */}
          <HeroMetrics
            analytics={overview?.analytics ?? null}
            fallback={{
              sessions: stats.totalSessions,
              messages: stats.totalMessages,
              toolCalls: stats.totalToolCalls,
              tokens: stats.totalTokens,
            }}
            extraTile={
              <ActiveModelKpi
                modelInfo={overview?.modelInfo ?? null}
                analytics={overview?.analytics ?? null}
                loading={overviewQuery.isLoading}
                unavailable={overviewQuery.isError || analyticsUnavailable}
              />
            }
            loading={overviewQuery.isLoading}
            unavailable={overviewQuery.isError || analyticsUnavailable}
          />

          {/* Keep the two operational summaries together. They are companion
            surfaces, and side-by-side desktop placement keeps the first
            viewport focused on decisions instead of two full-width cards. */}
          {layout.isVisible('finance_overview') ||
          layout.isVisible('trading_overview') ? (
            <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
              {layout.isVisible('finance_overview') ? (
                <WidgetShell id="finance_overview" layout={layout}>
                  <FinanceOverviewCard />
                </WidgetShell>
              ) : null}

              {layout.isVisible('trading_overview') ? (
                <WidgetShell id="trading_overview" layout={layout}>
                  <TradingOverviewCard />
                </WidgetShell>
              ) : null}
            </div>
          ) : null}

          {/* ── Analytics chart (left) + Top models / Provider mix / Cache
           efficiency stacked on the right. The right-side stack now
           occupies the full vertical of the chart so we don't get the
           floating-card empty-space Eric flagged in iter 008. ── */}
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-12">
            {layout.isVisible('analytics_chart') ? (
              <div className="min-w-0 lg:col-span-8">
                <WidgetShell id="analytics_chart" layout={layout}>
                  {overviewQuery.isError ? (
                    <UnavailableWidget
                      title="Usage analytics"
                      description="Analytics are temporarily unavailable. Retry sync above to restore the usage trend and insights."
                      actionBusy={overviewQuery.isFetching}
                      onAction={() => void overviewQuery.refetch()}
                    />
                  ) : (
                    <Suspense
                      fallback={
                        <div
                          role="status"
                          aria-busy="true"
                          aria-label="Loading analytics chart"
                          className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)]/55 text-[11px] text-[var(--theme-muted)]"
                        >
                          <span
                            aria-hidden
                            className="size-2 rounded-full bg-[var(--theme-accent)] motion-safe:animate-pulse"
                          />
                          <span>Loading analytics</span>
                        </div>
                      }
                    >
                      <AnalyticsChartCard
                        analytics={overview?.analytics ?? null}
                        insights={overview?.insights ?? []}
                        period={period}
                        onPeriodChange={setPeriod}
                        loading={overviewQuery.isFetching}
                        unavailable={analyticsUnavailable}
                      />
                    </Suspense>
                  )}
                </WidgetShell>
              </div>
            ) : null}
            {layout.isVisible('top_models') ||
            layout.isVisible('provider_mix') ||
            layout.isVisible('cache_efficiency') ||
            layout.isVisible('velocity') ||
            layout.isVisible('cost_ledger') ? (
              <div
                className={
                  layout.isVisible('analytics_chart')
                    ? 'min-w-0 flex flex-col gap-3 lg:col-span-4'
                    : 'min-w-0 flex flex-col gap-3 lg:col-span-12'
                }
              >
                {layout.isVisible('top_models') ? (
                  <WidgetShell id="top_models" layout={layout}>
                    <TopModelsCard
                      analytics={overview?.analytics ?? null}
                      loading={overviewQuery.isLoading}
                      unavailable={
                        overviewQuery.isError || analyticsUnavailable
                      }
                    />
                  </WidgetShell>
                ) : null}
                {layout.isVisible('cache_efficiency') ? (
                  <WidgetShell id="cache_efficiency" layout={layout}>
                    <CacheEfficiencyCard
                      analytics={overview?.analytics ?? null}
                      loading={overviewQuery.isLoading}
                      unavailable={
                        overviewQuery.isError || analyticsUnavailable
                      }
                    />
                  </WidgetShell>
                ) : null}
                {layout.isVisible('provider_mix') ? (
                  <WidgetShell id="provider_mix" layout={layout}>
                    <ProviderMixCard
                      analytics={overview?.analytics ?? null}
                      loading={overviewQuery.isLoading}
                      unavailable={
                        overviewQuery.isError || analyticsUnavailable
                      }
                    />
                  </WidgetShell>
                ) : null}
                {layout.isVisible('velocity') ? (
                  <WidgetShell id="velocity" layout={layout}>
                    <VelocityCard
                      analytics={overview?.analytics ?? null}
                      unavailable={
                        overviewQuery.isError || analyticsUnavailable
                      }
                    />
                  </WidgetShell>
                ) : null}
                {layout.isVisible('cost_ledger') ? (
                  <WidgetShell id="cost_ledger" layout={layout}>
                    <CostLedgerCard
                      analytics={overview?.analytics ?? null}
                      unavailable={
                        overviewQuery.isError || analyticsUnavailable
                      }
                    />
                  </WidgetShell>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ── Primary content: insights + Sessions Intelligence + side rail ──
           Iteration 006 layout per Eric:
           - Attention now rides the OpsStrip marquee, not the rail.
           - Achievements moved up to sit beside Top Models would push the chart out
             of place; instead it now lives at the *top* of the side rail since the
             rail itself is right of the chart, which produces the same visual order.
           - Proactive suggestions stay with the main-column insights so the
             desktop columns finish at a similar visual rhythm.
           - Logs default off; still toggleable from edit mode for power users. */}
          {hasLowerMainWidgets || hasLowerRailWidgets ? (
            <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-12">
              {/* Main column order: insight cards first, then Sessions
            Sessions Intelligence. The session panel only becomes a
            full-height anchor once there are enough rows to justify
            the extra room; short lists stay compact and scannable. */}
              {hasLowerMainWidgets ? (
                <div
                  className={cn(
                    'flex min-w-0 flex-col gap-3 lg:min-h-full',
                    hasLowerRailWidgets ? 'lg:col-span-8' : 'lg:col-span-12',
                  )}
                >
                  {layout.isVisible('operator_tip') ? (
                    <WidgetShell id="operator_tip" layout={layout}>
                      <OperatorTipCard overview={overview ?? null} />
                    </WidgetShell>
                  ) : null}
                  {layout.isVisible('proactive_suggestions') ? (
                    <WidgetShell id="proactive_suggestions" layout={layout}>
                      <ProactiveSuggestionsCard
                        overview={overview}
                        unavailable={overviewQuery.isError}
                      />
                    </WidgetShell>
                  ) : null}
                  {layout.isVisible('sessions_intelligence') ? (
                    <div
                      className={cn(
                        'flex flex-col',
                        sessionsQuery.isLoading || sessionRows.length >= 6
                          ? 'min-h-0 flex-1'
                          : '',
                      )}
                    >
                      <WidgetShell id="sessions_intelligence" layout={layout}>
                        {sessionsQuery.isError || sessionsUnavailable ? (
                          <UnavailableWidget
                            title="Recent Sessions"
                            description={sessionsUnavailableMessage}
                            actionLabel={
                              overviewQuery.isError
                                ? undefined
                                : 'Retry sessions'
                            }
                            actionBusy={manualRefreshPending}
                            onAction={() => void refreshDashboard()}
                          />
                        ) : (
                          <SessionsIntelligenceCard
                            sessions={sessionRows}
                            loading={sessionsQuery.isLoading}
                          />
                        )}
                      </WidgetShell>
                    </div>
                  ) : null}
                  {layout.isVisible('logs_tail') ? (
                    <WidgetShell id="logs_tail" layout={layout}>
                      <LogsTailCard
                        logs={overview?.logs ?? null}
                        loading={overviewQuery.isLoading}
                        unavailable={overviewQuery.isError}
                      />
                    </WidgetShell>
                  ) : null}
                </div>
              ) : null}
              {/* Side rail. Achievements is now first (sits beside Top Models
            visually since the rail is right of the chart row + sessions),
            then Skills, then the rhythm card. Mix & rhythm is the unique
            chart in this column — keeping it.
            `min-h-full` + the trailing `flex-1` rhythm card keep the
            companion rail balanced when the main column grows, without
            reserving extra space beneath the final widget. */}
              {hasLowerRailWidgets ? (
                <div
                  className={cn(
                    'flex min-w-0 flex-col gap-3 lg:min-h-full',
                    hasLowerMainWidgets ? 'lg:col-span-4' : 'lg:col-span-12',
                  )}
                >
                  <WidgetShell id="achievements" layout={layout}>
                    <AchievementsCard
                      achievements={overview?.achievements ?? null}
                      loading={overviewQuery.isLoading}
                      unavailable={overviewQuery.isError}
                    />
                  </WidgetShell>
                  <WidgetShell id="skills_usage" layout={layout}>
                    <SkillsUsageCard
                      usage={overview?.skillsUsage ?? null}
                      installedCount={skillsInstalled}
                      loading={skillsCountQuery.isLoading}
                      available={skillsAvailable}
                    />
                  </WidgetShell>
                  {/* `flex-1` here pushes the rhythm card to consume any
              remaining vertical space so the rail's bottom aligns
              with Sessions Intelligence. The card itself uses
              h-full + flex-1 to honor the stretch. */}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <WidgetShell id="mix_rhythm" layout={layout}>
                      <TokenMixHourCard
                        analytics={overview?.analytics ?? null}
                        sessions={sessionRows}
                        loading={
                          overviewQuery.isLoading || sessionsQuery.isLoading
                        }
                        unavailable={
                          overviewQuery.isError || analyticsUnavailable
                        }
                      />
                    </WidgetShell>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </DashboardRefreshProvider>
  )
}
