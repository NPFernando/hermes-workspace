import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from '@/lib/utils'

const BLENDED_COST_PER_MILLION_TOKENS = 5

function estimateTokenCost(totalTokens: number): number {
  return (Math.max(0, totalTokens) / 1_000_000) * BLENDED_COST_PER_MILLION_TOKENS
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 0.1 ? 2 : 3)}`
}

export type MissionCostWorker = {
  id: string
  label: string
  totalTokens: number
  personaEmoji: string
  personaName: string
}

export function MissionCostSection({ totalTokens, workers, expanded, onToggle }: { totalTokens: number; workers: Array<MissionCostWorker>; expanded: boolean; onToggle: () => void }) {
  const estimatedCost = estimateTokenCost(totalTokens)

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-5 py-4">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-start justify-between gap-4 text-left">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--theme-muted)]">Mission Cost</p>
          <p className="mt-1 text-sm text-[var(--theme-muted-2)]">Approximate at $5 / 1M tokens blended from input/output pricing.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-xs font-medium text-[var(--theme-text)]">
          {expanded ? 'Hide' : 'Show'}
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={1.7} className={cn('transition-transform duration-200', expanded ? 'rotate-180' : 'rotate-0')} />
        </span>
      </button>

      {expanded ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">Total Tokens</p>
              <p className="mt-2 text-2xl font-semibold text-[var(--theme-text)]">{totalTokens.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">Estimated Cost</p>
              <p className="mt-2 text-2xl font-semibold text-[var(--theme-text)]">{formatUsd(estimatedCost)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)]">
            <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">
              <span>Workers</span>
              <span>Cost</span>
            </div>
            {workers.length > 0 ? (
              <div className="divide-y divide-[var(--theme-border)]">
                {workers.map((worker) => (
                  <div key={worker.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="font-medium text-[var(--theme-text)]">
                      {worker.personaEmoji} {worker.personaName}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--theme-muted)]">{worker.label}</span>
                    <span className="text-xs text-[var(--theme-muted)]">{worker.totalTokens.toLocaleString()} tok</span>
                    <span className="min-w-[4.5rem] text-right font-medium text-[var(--theme-text)]">{formatUsd(estimateTokenCost(worker.totalTokens))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-[var(--theme-muted)]">Per-worker token details were not captured for this mission.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

