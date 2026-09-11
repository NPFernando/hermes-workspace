import { useId, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Award01Icon,
  CancelIcon,
} from '@hugeicons/core-free-icons'
import { DashboardDialog } from './dashboard-dialog'
import {
  DashboardEmptyState,
  DashboardLoadingState,
  DashboardUnavailableState,
} from './dashboard-empty-state'
import type {
  DashboardAchievementUnlock,
  DashboardOverview,
} from '@/server/dashboard-aggregator'

const TIER_COLORS: Record<string, string> = {
  Copper: '#b45309',
  Silver: '#9ca3af',
  Gold: '#facc15',
  Diamond: '#22d3ee',
  Olympian: '#f472b6',
}

function tierColor(tier: string | null): string {
  if (!tier) return 'var(--theme-muted)'
  return TIER_COLORS[tier] ?? 'var(--theme-muted)'
}

function relativeTime(unlockedAtSeconds: number | null): string {
  if (!unlockedAtSeconds) return ''
  const diff = Date.now() / 1000 - unlockedAtSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86_400)}d ago`
}

function AchievementRow({
  unlock,
  compact = false,
}: {
  unlock: DashboardAchievementUnlock
  compact?: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded border px-2 py-1.5 border-[var(--theme-border)]">
      <span
        aria-hidden
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{
          background:
            'color-mix(in srgb, var(--theme-accent) 12%, transparent)',
          color: tierColor(unlock.tier),
        }}
      >
        <HugeiconsIcon icon={Award01Icon} size={15} strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-[var(--theme-text)]">
          {unlock.name}
        </div>
        {!compact ? (
          <div className="truncate text-[10px] text-[var(--theme-muted)]">
            {unlock.description || unlock.category}
          </div>
        ) : null}
      </div>
      <div className="text-right">
        {unlock.tier ? (
          <span
            className="block text-[9px] font-mono uppercase tracking-[0.1em]"
            style={{ color: tierColor(unlock.tier) }}
          >
            {unlock.tier}
          </span>
        ) : null}
        <span className="block text-[9px] font-mono text-[var(--theme-muted)]">
          {relativeTime(unlock.unlockedAt)}
        </span>
      </div>
    </div>
  )
}

/**
 * Compact achievements panel: shows the 3 most recent unlocks plus a
 * "View all" button that opens a modal with the full ribbon. Hides
 * itself when the achievements plugin isn't installed (section comes
 * back null from the aggregator).
 */
export function AchievementsCard({
  achievements,
  loading = false,
  unavailable = false,
}: {
  achievements: DashboardOverview['achievements']
  loading?: boolean
  unavailable?: boolean
}) {
  const titleId = useId()
  const [showAll, setShowAll] = useState(false)
  const [allUnlocks, setAllUnlocks] =
    useState<Array<DashboardAchievementUnlock> | null>(null)
  const [loadingAll, setLoadingAll] = useState(false)
  const [allError, setAllError] = useState<string | null>(null)

  if (loading) return <DashboardLoadingState title="Achievements" />

  if (!achievements) {
    if (!unavailable) {
      return (
        <DashboardEmptyState
          title="Achievements"
          description="Achievements are not enabled for this workspace."
          statusLabel="not enabled"
        />
      )
    }
    return <DashboardUnavailableState title="Achievements" />
  }

  const loadAllAchievements = async () => {
    if (allUnlocks !== null) return
    setLoadingAll(true)
    setAllError(null)
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), 5_000)
    try {
      const res = await fetch('/api/dashboard/overview?achievements=12', {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error('The achievement list could not be loaded.')
      const data = (await res.json()) as DashboardOverview
      setAllUnlocks(data.achievements?.recentUnlocks ?? [])
    } catch (err) {
      setAllError(
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Loading achievements timed out. Check the connection and retry.'
          : 'The achievement list is temporarily unavailable. Retry to load it.',
      )
    } finally {
      globalThis.clearTimeout(timeout)
      setLoadingAll(false)
    }
  }

  const openModal = () => {
    setShowAll(true)
    if (allUnlocks === null) void loadAllAchievements()
  }

  return (
    <>
      <div
        className="relative overflow-hidden rounded-xl border p-3"
        style={{
          background:
            'linear-gradient(150deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
          borderColor: 'var(--theme-border)',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
          style={{
            background:
              'linear-gradient(90deg, #facc15, color-mix(in srgb, #facc15 40%, transparent), transparent)',
          }}
        />
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Award01Icon}
              size={14}
              strokeWidth={1.5}
              className="text-[var(--theme-muted)]"
            />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
              Achievements
            </h2>
          </div>
          {achievements.totalUnlocked > 0 ? (
            <button
              type="button"
              onClick={openModal}
              className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded px-1 font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--theme-muted)] motion-safe:transition-colors hover:text-[var(--theme-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
            >
              <span>{achievements.totalUnlocked} unlocked · view all</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={12}
                strokeWidth={1.8}
              />
            </button>
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--theme-muted)]">
              0 unlocked
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {achievements.recentUnlocks.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-3 text-center">
              <p className="text-[11px] font-medium text-[var(--theme-text)]">
                No unlocks yet
              </p>
              <p className="max-w-[24ch] text-[10px] leading-relaxed text-[var(--theme-muted)]">
                Complete sessions and use skills to earn milestones.
              </p>
            </div>
          ) : (
            // Render every unlock the aggregator returns so the card
            // grows to consume vertical space (Eric's iter-007 ask).
            // Default count is now 5 so the rail has more presence.
            achievements.recentUnlocks.map((unlock) => (
              <AchievementRow key={unlock.id} unlock={unlock} />
            ))
          )}
        </div>
      </div>

      {showAll ? (
        <DashboardDialog
          titleId={titleId}
          onClose={() => setShowAll(false)}
          className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg border bg-[var(--theme-card)] border-[var(--theme-border)]"
        >
          <div className="flex items-center justify-between border-b px-4 py-3 border-[var(--theme-border)]">
            <h2
              id={titleId}
              className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--theme-text)]"
            >
              Achievement Ribbon
            </h2>
            <button
              type="button"
              onClick={() => setShowAll(false)}
              aria-label="Close"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0 lg:min-w-0"
            >
              <HugeiconsIcon
                icon={CancelIcon}
                size={16}
                strokeWidth={1.5}
                className="text-[var(--theme-muted)]"
              />
            </button>
          </div>
          <div className="max-h-[64vh] overflow-y-auto p-4">
            {loadingAll ? (
              <div
                role="status"
                aria-busy="true"
                className="py-8 text-center text-[11px] text-[var(--theme-muted)]"
              >
                Loading achievements…
              </div>
            ) : allError ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p
                  role="alert"
                  className="text-[11px] text-[var(--theme-danger,#ef4444)]"
                >
                  {allError}
                </p>
                <button
                  type="button"
                  onClick={() => void loadAllAchievements()}
                  className="rounded-md border border-[var(--theme-border)] px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)]"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {(allUnlocks ?? achievements.recentUnlocks).map((unlock) => (
                  <AchievementRow key={unlock.id} unlock={unlock} />
                ))}
              </div>
            )}
          </div>
        </DashboardDialog>
      ) : null}
    </>
  )
}
