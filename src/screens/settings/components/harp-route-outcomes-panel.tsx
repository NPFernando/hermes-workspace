import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Analytics01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { HarpRouteStats } from '@/server/harp-route-stats'
import { cn } from '@/lib/utils'

type RouteStatsApiResponse = {
  ok: boolean
  error?: string
} & Partial<HarpRouteStats>

const WINDOWS = [7, 30, 90] as const

export async function fetchHarpRouteStats(
  days: number,
): Promise<HarpRouteStats> {
  const res = await fetch(`/api/harp-route-stats?days=${days}`, {
    cache: 'no-store',
  })
  const data = (await res.json()) as RouteStatsApiResponse
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Failed to load route outcomes')
  }
  return data as HarpRouteStats
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function rateClass(rate: number, demoted: boolean): string {
  if (demoted) return 'text-red-600 dark:text-red-400'
  if (rate < 0.7) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-surface p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--theme-muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-[var(--theme-text)]">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-[var(--theme-muted)]">{hint}</p>
    </div>
  )
}

function PersonaChip({ name, detail }: { name: string; detail?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-hover)] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[var(--theme-text)]">
      {name}
      {detail ? (
        <span className="tabular-nums text-[var(--theme-muted)]">{detail}</span>
      ) : null}
    </span>
  )
}

/** Outcome learning: how planned routes actually performed (harp-route-stats-v1). Read-only. */
export function HarpRouteOutcomesPanel() {
  const [days, setDays] = useState<number>(30)
  const { data, error, isLoading } = useQuery({
    queryKey: ['harp-route-stats', days],
    queryFn: () => fetchHarpRouteStats(days),
    retry: 1,
    refetchInterval: () => 60_000,
    refetchOnWindowFocus: true,
  })

  const successes = data?.routes.reduce((sum, r) => sum + r.success, 0) ?? 0
  const demoted = data?.routes.filter((r) => r.demoted).length ?? 0

  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 shadow-sm backdrop-blur-xl md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)]">
            <HugeiconsIcon icon={Analytics01Icon} size={15} strokeWidth={1.8} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--theme-text)]">
              Route Outcomes
            </h3>
            <p className="mt-0.5 text-xs text-[var(--theme-muted)]">
              How planned routes actually performed. Weak routes are demoted in
              cost strategies; the policy order is never changed.
            </p>
          </div>
        </div>
        <div
          className="flex shrink-0 gap-1"
          role="group"
          aria-label="Outcome window"
        >
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className={cn(
                'rounded-md border px-2 py-0.5 text-[11px]',
                days === w
                  ? 'border-[var(--theme-accent)] text-[var(--theme-text)]'
                  : 'border-[var(--theme-border)] text-[var(--theme-muted)]',
              )}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-[var(--theme-muted)]">
          Loading route outcomes…
        </p>
      ) : error && !data ? (
        <p className="text-xs text-red-500">
          {error instanceof Error ? error.message : 'Failed to load'}
        </p>
      ) : data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Stat
              label="Reported outcomes"
              value={String(data.outcomes)}
              hint={`${successes} succeeded · last ${data.window_days}d`}
            />
            <Stat
              label="Demoted routes"
              value={String(demoted)}
              hint={`< ${percent(data.demote_below)} after ${data.min_samples}+ outcomes`}
            />
            <Stat
              label="Classifier accuracy"
              value={percent(data.classifier.accuracy)}
              hint={`${data.classifier.agreed} agreed · ${data.classifier.corrected} corrected`}
            />
            <Stat
              label="Outcome coverage"
              value={data.coverage ? percent(data.coverage.rate) : '—'}
              hint={
                data.coverage
                  ? `${data.coverage.reported} of ${data.coverage.plans} plans reported`
                  : 'not reported by this HARP version'
              }
            />
          </div>

          {data.routes.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--theme-muted)]">
              No outcomes reported yet. Agents report with{' '}
              <code>harp_route_outcome</code> (MCP) or{' '}
              <code>harp route outcome &lt;plan_id&gt; --outcome success</code>.
              {data.coverage && data.coverage.by_host.length > 0 ? (
                <>
                  {' '}
                  Plans awaiting outcomes:{' '}
                  {data.coverage.by_host
                    .map((h) => `${h.host} ${h.reported}/${h.plans}`)
                    .join(', ')}
                  .
                </>
              ) : null}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--theme-muted)]">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">Task</th>
                    <th className="py-1 pr-3 font-semibold">Route</th>
                    <th className="py-1 pr-3 text-right font-semibold">n</th>
                    <th className="py-1 pr-3 text-right font-semibold">
                      ✓ / ✗ / ↑
                    </th>
                    <th className="py-1 text-right font-semibold">Success</th>
                  </tr>
                </thead>
                <tbody>
                  {data.routes.map((r) => (
                    <tr
                      key={`${r.task_family}|${r.provider}|${r.model}`}
                      className="border-t border-[var(--theme-border)]"
                    >
                      <td className="py-1.5 pr-3 text-[var(--theme-text)]">
                        {r.task_family}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] text-[var(--theme-text)]">
                        {r.provider}/{r.model}
                        {r.demoted && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-sans text-[10px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            demoted
                          </span>
                        )}
                        {r.observed > 0 && (
                          <span
                            className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 font-sans text-[10px] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                            title="Outcomes from shadow-mode runs: success rates only, never tier raises"
                          >
                            {r.observed} observed
                          </span>
                        )}
                        {r.agents.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.agents.map((a) => (
                              <PersonaChip key={a} name={a} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {r.n}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--theme-muted)]">
                        {r.success} / {r.failure} / {r.escalated}
                      </td>
                      <td
                        className={cn(
                          'py-1.5 text-right font-semibold tabular-nums',
                          rateClass(r.success_rate, r.demoted),
                        )}
                      >
                        {percent(r.success_rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.coverage && data.coverage.by_agent.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)]">
                Coverage by agent (reported / planned)
              </p>
              <div className="flex flex-wrap gap-1">
                {data.coverage.by_agent.map((a) => (
                  <PersonaChip
                    key={a.agent}
                    name={a.agent}
                    detail={`${a.reported}/${a.plans}`}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
