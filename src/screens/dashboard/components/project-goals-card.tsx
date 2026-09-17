import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

type GoalState = 'completed' | 'active' | 'blocked' | 'deployed'

type Goal = {
  id: number
  title: string
  state: GoalState
  detail: string
  evidence: string
  nextAction: string
}

type LiveReadiness = {
  overall: string
  generatedAt: string
  blockers: Array<string>
  warnings: Array<string>
}

// Deliberately declarative: this is the operator-facing cross-project
// checklist. Runtime health and usage remain sourced from the dashboard API;
// these records capture the human acceptance state that APIs cannot infer.
const GOALS: Array<Goal> = [
  {
    id: 1,
    title: 'External astrology smoke',
    state: 'deployed',
    detail: 'Public HTTPS checks pass.',
    evidence: 'External smoke workflow and live route checks.',
    nextAction: 'Run after each production release.',
  },
  {
    id: 2,
    title: 'Authenticated production smoke',
    state: 'deployed',
    detail: 'Authenticated browser smoke passes against production.',
    evidence: 'Live dashboard, finance, Dify, queue, API, and mobile checks.',
    nextAction: 'Run after each production release.',
  },
  {
    id: 3,
    title: 'Deployment health checks',
    state: 'deployed',
    detail: 'Exact commit, readiness, and release checks.',
    evidence: 'Deploy guard and release smoke scripts.',
    nextAction: 'Keep exact-SHA checks required for releases.',
  },
  {
    id: 4,
    title: 'High dependency vulnerability',
    state: 'completed',
    detail: 'Patched dependency chain verified.',
    evidence: 'Dependency audit and regression checks.',
    nextAction: 'Recheck on dependency updates.',
  },
  {
    id: 5,
    title: 'Privacy vault audit',
    state: 'completed',
    detail: 'Birth/location storage and sync paths audited.',
    evidence: 'Vault migration and storage-path review.',
    nextAction: 'Review when a new sync path is added.',
  },
  {
    id: 6,
    title: 'Vault recovery tests',
    state: 'active',
    detail: 'Backup, migration, and rollback coverage is present.',
    evidence: 'Vault backup and recovery test suite.',
    nextAction: 'Add and verify a scheduled restore drill.',
  },
  {
    id: 7,
    title: 'HARP observability hooks',
    state: 'deployed',
    detail: 'Unsupported-hook warnings removed from live startup.',
    evidence: 'HARP startup diagnostics and route checks.',
    nextAction: 'Keep execution disabled until readiness gates pass.',
  },
  {
    id: 8,
    title: 'Hindsight daemon guard',
    state: 'deployed',
    detail: 'Cron duplicate-spawn regression covered.',
    evidence: 'Cron worker regression test and deployed fix.',
    nextAction: 'Monitor memory pressure after agent upgrades.',
  },
  {
    id: 9,
    title: 'AI usage dashboard',
    state: 'deployed',
    detail:
      'Provider usage, 31-day history, limits, alerts, and budgets are integrated.',
    evidence:
      'Provider history, limit warnings, monthly budget API, and chart panel.',
    nextAction: 'Tune thresholds from observed provider usage.',
  },
  {
    id: 10,
    title: '/queue dispatch control',
    state: 'deployed',
    detail:
      'Persistence, retry, cancel, priorities, and serial dispatch are live.',
    evidence: 'Queue API tests and cockpit browser smoke.',
    nextAction: 'Review dead-letter notifications in production.',
  },
  {
    id: 11,
    title: 'Shared usage budgets',
    state: 'deployed',
    detail: 'Shared warnings and configurable monthly caps are live.',
    evidence:
      'Budget configuration, provider usage APIs, and monthly cap tests.',
    nextAction: 'Review budget thresholds monthly.',
  },
  {
    id: 12,
    title: 'Fork sync protection',
    state: 'completed',
    detail:
      'Dry-run, scheduled previews, custom-change safeguards, and approval evidence are present.',
    evidence:
      'Fork preview, scheduled-report, and approval-evidence tests pass.',
    nextAction: 'Review scheduled reports before approving a sync.',
  },
  {
    id: 13,
    title: 'Deployment recovery controls',
    state: 'deployed',
    detail: 'Stale-run and exact-SHA guards are live.',
    evidence: 'Canary and rollback guard scripts.',
    nextAction: 'Add authenticated rollback browser coverage.',
  },
  {
    id: 14,
    title: 'HARP readiness diagnostics',
    state: 'deployed',
    detail:
      'Freshness, health, quality, and conflict gates are surfaced; execution remains disabled.',
    evidence: 'Readiness endpoint and diagnostic blockers.',
    nextAction: 'Resolve stale Graphify and migration evidence with approval.',
  },
  {
    id: 15,
    title: 'Astrology UX refinement',
    state: 'active',
    detail: 'Saved profiles, bilingual SEO, PWA, and accessibility.',
    evidence: 'Feature registry, PWA manifest, and vault tests.',
    nextAction: 'Complete keyboard and contrast audit.',
  },
  {
    id: 16,
    title: 'Finance institution reuse',
    state: 'deployed',
    detail: 'Bank/branch autocomplete and stable catalog links are live.',
    evidence: 'Institution/branch schema and UI flows.',
    nextAction: 'Verify live persistence after the next migration.',
  },
  {
    id: 17,
    title: 'Production observability',
    state: 'active',
    detail: 'Health, memory pressure, OOM, and stale-build findings are monitored.',
    evidence: 'Five-minute systemd monitor; webhook delivery is not configured.',
    nextAction: 'Configure a secret-safe operator alert endpoint.',
  },
  {
    id: 18,
    title: 'Private-data-safe Dify pilot',
    state: 'active',
    detail:
      'Optional workbench remains isolated from private data with versioned, bounded runs.',
    evidence:
      'Allowlisted workflows, metadata-only history, retries, timeouts, cancellation, and version tests.',
    nextAction:
      'Run the public-only pilot and review quality before enabling broader use.',
  },
  {
    id: 19,
    title: 'Dependency review automation',
    state: 'completed',
    detail: 'Weekly Dependabot coverage configured.',
    evidence: 'Repository Dependabot configuration and workflow.',
    nextAction: 'Review open update PRs monthly.',
  },
  {
    id: 20,
    title: 'Unified project dashboard',
    state: 'deployed',
    detail: 'This control-plane view is live with acceptance-state filters.',
    evidence: 'Project goals card and state filters.',
    nextAction: 'Keep evidence current as goals move state.',
  },
]

const STATE_LABEL: Record<GoalState, string> = {
  completed: 'Completed',
  active: 'Active',
  blocked: 'Blocked',
  deployed: 'Deployed',
}

export function ProjectGoalsCard() {
  const [filter, setFilter] = useState<GoalState | 'all'>('all')
  const [liveReadiness, setLiveReadiness] = useState<LiveReadiness | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(false)
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const counts = useMemo(
    () =>
      GOALS.reduce<Record<GoalState, number>>(
        (result, goal) => ({ ...result, [goal.state]: result[goal.state] + 1 }),
        { completed: 0, active: 0, blocked: 0, deployed: 0 },
      ),
    [],
  )
  const visible =
    filter === 'all' ? GOALS : GOALS.filter((goal) => goal.state === filter)

  const refreshReadiness = async () => {
    setReadinessLoading(true)
    setReadinessError(null)
    try {
      const response = await fetch('/api/production-readiness?skipTests=1', {
        headers: { Accept: 'application/json' },
      })
      const data = (await response.json()) as {
        ok?: boolean
        error?: string
        report?: LiveReadiness
      }
      if (!response.ok || !data.ok || !data.report) {
        throw new Error(data.error || `Readiness request failed (${response.status})`)
      }
      setLiveReadiness(data.report)
    } catch (error) {
      setReadinessError(error instanceof Error ? error.message : 'Readiness request failed.')
    } finally {
      setReadinessLoading(false)
    }
  }

  return (
    <section
      className="surface-card card-glow rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5"
      aria-labelledby="project-goals-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
            Control plane
          </p>
          <h2
            id="project-goals-heading"
            className="mt-1 text-lg font-semibold text-[var(--theme-text)]"
          >
            Project goals
          </h2>
          <p className="mt-1 text-xs text-muted">
            Cross-project acceptance state and the next actionable work.
          </p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-xs text-muted">
          {GOALS.length} tracked
        </span>
      </div>
      <div
        className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        aria-label="Filter project goals"
      >
        {(['all', 'deployed', 'active', 'blocked'] as const).map((key) => {
          const count = key === 'all' ? GOALS.length : counts[key]
          return (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              aria-controls="project-goals-list"
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-lg border px-2 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)]',
                filter === key
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-subtle)] text-[var(--theme-text)]'
                  : 'border-[var(--theme-border)] text-muted hover:text-[var(--theme-text)]',
              )}
            >
              <span className="block font-semibold">{count}</span>
              <span className="capitalize">{key}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--theme-text)]">
              Live evidence
            </h3>
            <p className="mt-1 text-xs text-muted">
              Readiness, deployment blockers, backup gates, and release status.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshReadiness()}
            disabled={readinessLoading}
            className="min-h-9 rounded-lg border border-[var(--theme-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-text)] disabled:opacity-50"
          >
            {readinessLoading ? 'Checking…' : 'Refresh evidence'}
          </button>
        </div>
        {readinessError && (
          <p className="mt-2 text-xs text-[var(--theme-danger)]" role="alert">
            {readinessError}
          </p>
        )}
        {liveReadiness && (
          <div className="mt-3 space-y-2 text-xs">
            <div className={cn(
              'rounded-md border px-2 py-1.5 font-semibold',
              liveReadiness.overall === 'ready'
                ? 'border-[var(--theme-success)]/40 text-[var(--theme-success)]'
                : liveReadiness.overall === 'blocked'
                  ? 'border-[var(--theme-danger)]/40 text-[var(--theme-danger)]'
                  : 'border-[var(--theme-warning)]/40 text-[var(--theme-warning)]',
            )}>
              Overall: {liveReadiness.overall} · {new Date(liveReadiness.generatedAt).toLocaleString()}
            </div>
            {liveReadiness.blockers.length > 0 && (
              <p className="text-[var(--theme-danger)]">
                <span className="font-semibold">Blockers:</span> {liveReadiness.blockers.join(' · ')}
              </p>
            )}
            {liveReadiness.warnings.length > 0 && (
              <p className="text-[var(--theme-warning)]">
                <span className="font-semibold">Warnings:</span> {liveReadiness.warnings.join(' · ')}
              </p>
            )}
          </div>
        )}
      </div>
      <ul
        id="project-goals-list"
        className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto pr-1"
        aria-live="polite"
      >
        {visible.map((goal) => (
          <li
            key={goal.id}
            className="flex items-start gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2"
          >
            <span className="mt-0.5 w-6 shrink-0 font-mono text-[10px] text-muted">
              #{goal.id}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-[var(--theme-text)]">
                {goal.title}
              </span>
              <span className="block text-xs text-muted">{goal.detail}</span>
              <dl className="mt-2 grid gap-1 text-[11px] leading-relaxed text-muted sm:grid-cols-2">
                <div>
                  <dt className="inline font-semibold text-[var(--theme-text)]">
                    Evidence:{' '}
                  </dt>
                  <dd className="inline">{goal.evidence}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-[var(--theme-text)]">
                    Next:{' '}
                  </dt>
                  <dd className="inline">{goal.nextAction}</dd>
                </div>
              </dl>
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                goal.state === 'blocked'
                  ? 'bg-red-500/15 text-red-300'
                  : goal.state === 'active'
                    ? 'bg-amber-500/15 text-amber-300'
                    : goal.state === 'deployed'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-500/15 text-slate-300',
              )}
            >
              {STATE_LABEL[goal.state]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
