import { HugeiconsIcon } from '@hugeicons/react'
import { FlowIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { UseResearchCardResult } from '@/hooks/use-research-card'

export function ResearchCard({ researchCard }: { researchCard: UseResearchCardResult | null | undefined }) {
  if (!researchCard || researchCard.steps.length === 0) return null

  return (
    <div className="border-t border-primary-200/60 dark:border-neutral-800 px-4 py-3 space-y-1.5 max-h-48 overflow-y-auto">
      {researchCard.steps.map((step) => (
        <div key={step.id} className="flex items-start gap-2 text-xs">
          <HugeiconsIcon
            icon={step.status === 'done' ? Tick02Icon : FlowIcon}
            size={13}
            strokeWidth={1.5}
            className={
              step.status === 'done'
                ? 'mt-0.5 shrink-0 text-green-400'
                : 'mt-0.5 shrink-0 text-accent-500 opacity-70'
            }
          />
          <span className="text-primary-600 dark:text-neutral-400">{step.label}</span>
        </div>
      ))}
      {researchCard.isActive && (
        <div className="pl-5 text-xs text-accent-500 animate-pulse">Researching…</div>
      )}
    </div>
  )
}
