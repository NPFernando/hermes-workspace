import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { formatSkillName } from '@/screens/dashboard/lib/formatters'

/**
 * Skills usage card. Replaces the lonely "60" tile that the Hermes
 * Agent product review (correctly) flagged as wasted space. Renders
 * a horizontal bar chart of the top-5 most-used skills in the
 * analytics window, sourced from `analytics.skills.top_skills` (the
 * agent-confirmed shape) so we no longer enumerate the full installed
 * list either.
 *
 * Falls back to the Skills installed count when usage data isn't
 * present (e.g. fresh install).
 */
export function SkillsUsageCard({
  usage,
  installedCount,
  loading = false,
  available = true,
}: {
  usage: DashboardOverview['skillsUsage']
  /** null = count not loaded (query pending/failed) — distinct from a real 0 */
  installedCount: number | null
  loading?: boolean
  available?: boolean
}) {
  const headingId = useId()
  const summaryId = useId()
  const hasUsage = !!usage && usage.topSkills.length > 0
  const top = hasUsage ? usage.topSkills : []
  const max = top[0]?.totalCount || 1

  return (
    <Link
      to={available ? '/skills' : '/conductor'}
      aria-labelledby={headingId}
      aria-describedby={summaryId}
      className="group relative flex w-full flex-col gap-2 overflow-hidden rounded-xl border px-3 py-2.5 text-left motion-safe:transition-colors hover:bg-[color-mix(in_srgb,var(--theme-card)_85%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)]"
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
            'linear-gradient(90deg, var(--theme-warning), color-mix(in srgb, var(--theme-warning) 40%, transparent), transparent)',
        }}
      />
      <div className="flex items-center justify-between">
        <h2
          id={headingId}
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]"
        >
          Skills usage
        </h2>
        <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--theme-muted)] motion-safe:transition-colors group-hover:text-[var(--theme-accent)]">
          {!available
            ? 'connect gateway'
            : loading
              ? 'syncing'
              : hasUsage
                ? installedCount != null
                  ? `${usage.distinctSkills} of ${installedCount} used`
                  : `${usage.distinctSkills} used`
                : installedCount != null
                  ? `${installedCount} installed`
                  : 'skills'}
          <>
            <span aria-hidden>·</span>
            <span>{available ? 'manage' : 'connect'}</span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={1.8}
            />
          </>
        </span>
      </div>

      <div id={summaryId}>
        {hasUsage ? (
          <ul className="flex flex-col gap-1.5">
            {top.slice(0, 5).map((s) => {
              const widthPct = Math.max(
                2,
                Math.round((s.totalCount / max) * 100),
              )
              return (
                <li key={s.skill}>
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span
                      className="truncate font-mono text-[var(--theme-text)]"
                      title={s.skill}
                    >
                      {formatSkillName(s.skill)}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--theme-muted)]">
                      {s.totalCount}
                      <span className="ml-1">·</span>
                      <span className="ml-1">{s.percentage.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div
                    className="mt-0.5 h-1 w-full overflow-hidden rounded-full"
                    style={{
                      background:
                        'color-mix(in srgb, var(--theme-border) 50%, transparent)',
                    }}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${widthPct}%`,
                        background:
                          'linear-gradient(90deg, var(--theme-warning), color-mix(in srgb, var(--theme-warning) 60%, transparent))',
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : !available ? (
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            skills unavailable until gateway reconnects
          </div>
        ) : loading ? (
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            syncing skill index
          </div>
        ) : installedCount === 0 ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-medium text-[var(--theme-text)]">
              No skills installed
            </p>
            <p className="text-[10px] leading-relaxed text-[var(--theme-muted)]">
              Add a workspace skill to unlock usage insights.
            </p>
          </div>
        ) : (
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            {installedCount === null
              ? 'skill count unavailable'
              : 'no usage in this window yet'}
          </div>
        )}
      </div>
    </Link>
  )
}
