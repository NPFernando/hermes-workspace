import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

type GoalState = 'completed' | 'active' | 'blocked' | 'deployed'

type Goal = {
  id: number
  title: string
  state: GoalState
  detail: string
}

// Deliberately declarative: this is the operator-facing cross-project
// checklist. Runtime health and usage remain sourced from the dashboard API;
// these records capture the human acceptance state that APIs cannot infer.
const GOALS: Array<Goal> = [
  { id: 1, title: 'External astrology smoke', state: 'deployed', detail: 'Public HTTPS checks pass.' },
  { id: 2, title: 'Authenticated production smoke', state: 'blocked', detail: 'Needs local AUTH_E2E_PASSWORD.' },
  { id: 3, title: 'Deployment health checks', state: 'deployed', detail: 'Exact commit, readiness, and release checks.' },
  { id: 4, title: 'High dependency vulnerability', state: 'completed', detail: 'Patched dependency chain verified.' },
  { id: 5, title: 'Privacy vault audit', state: 'completed', detail: 'Birth/location storage and sync paths audited.' },
  { id: 6, title: 'Vault recovery tests', state: 'completed', detail: 'Backup, migration, and rollback coverage present.' },
  { id: 7, title: 'HARP observability hooks', state: 'deployed', detail: 'Unsupported-hook warnings removed from live startup.' },
  { id: 8, title: 'Hindsight daemon guard', state: 'deployed', detail: 'Cron duplicate-spawn regression covered.' },
  { id: 9, title: 'AI usage dashboard', state: 'deployed', detail: 'Provider usage and history are integrated.' },
  { id: 10, title: '/queue dispatch control', state: 'deployed', detail: 'Persistence, retry, cancel, priorities, and serial dispatch are live.' },
  { id: 11, title: 'Shared usage budgets', state: 'deployed', detail: 'Warnings and provider history are live.' },
  { id: 12, title: 'Fork sync protection', state: 'completed', detail: 'Dry-run and custom-change safeguards are present.' },
  { id: 13, title: 'Deployment recovery controls', state: 'deployed', detail: 'Stale-run and exact-SHA guards are live.' },
  { id: 14, title: 'HARP readiness diagnostics', state: 'deployed', detail: 'Freshness, health, quality, and conflict gates are surfaced; execution remains disabled.' },
  { id: 15, title: 'Astrology UX refinement', state: 'active', detail: 'Saved profiles, bilingual SEO, PWA, and accessibility.' },
  { id: 16, title: 'Finance institution reuse', state: 'deployed', detail: 'Bank/branch autocomplete and stable catalog links are live.' },
  { id: 17, title: 'Production observability', state: 'deployed', detail: 'Uptime, memory pressure, OOM, and error alerts.' },
  { id: 18, title: 'Private-data-safe Dify pilot', state: 'active', detail: 'Optional workbench remains isolated from private data.' },
  { id: 19, title: 'Dependency review automation', state: 'completed', detail: 'Weekly Dependabot coverage configured.' },
  { id: 20, title: 'Unified project dashboard', state: 'deployed', detail: 'This control-plane view is live with acceptance-state filters.' },
]

const STATE_LABEL: Record<GoalState, string> = {
  completed: 'Completed',
  active: 'Active',
  blocked: 'Blocked',
  deployed: 'Deployed',
}

export function ProjectGoalsCard() {
  const [filter, setFilter] = useState<GoalState | 'all'>('all')
  const counts = useMemo(
    () =>
      GOALS.reduce<Record<GoalState, number>>(
        (result, goal) => ({ ...result, [goal.state]: result[goal.state] + 1 }),
        { completed: 0, active: 0, blocked: 0, deployed: 0 },
      ),
    [],
  )
  const visible = filter === 'all' ? GOALS : GOALS.filter((goal) => goal.state === filter)

  return (
    <section className="surface-card card-glow rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5" aria-labelledby="project-goals-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">Control plane</p>
          <h2 id="project-goals-heading" className="mt-1 text-lg font-semibold text-[var(--theme-text)]">Project goals</h2>
          <p className="mt-1 text-xs text-muted">Cross-project acceptance state and the next actionable work.</p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-xs text-muted">{GOALS.length} tracked</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Filter project goals">
        {(['all', 'deployed', 'active', 'blocked'] as const).map((key) => {
          const count = key === 'all' ? GOALS.length : counts[key]
          return (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn('rounded-lg border px-2 py-2 text-left text-xs transition-colors', filter === key ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-subtle)] text-[var(--theme-text)]' : 'border-[var(--theme-border)] text-muted hover:text-[var(--theme-text)]')}
            >
              <span className="block font-semibold">{count}</span>
              <span className="capitalize">{key}</span>
            </button>
          )
        })}
      </div>
      <ul className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
        {visible.map((goal) => (
          <li key={goal.id} className="flex items-start gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2">
            <span className="mt-0.5 w-6 shrink-0 font-mono text-[10px] text-muted">#{goal.id}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-[var(--theme-text)]">{goal.title}</span>
              <span className="block text-xs text-muted">{goal.detail}</span>
            </span>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', goal.state === 'blocked' ? 'bg-red-500/15 text-red-300' : goal.state === 'active' ? 'bg-amber-500/15 text-amber-300' : goal.state === 'deployed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300')}>
              {STATE_LABEL[goal.state]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
