import { memo, useMemo } from 'react'
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from '@/components/ui/preview-card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ContextMeterProps = {
  usedTokens?: number
  maxTokens?: number
}

function ContextMeterComponent({ usedTokens, maxTokens }: ContextMeterProps) {
  const { percentage, usedLabel, leftPercentage } = useMemo(() => {
    if (
      typeof usedTokens !== 'number' ||
      typeof maxTokens !== 'number' ||
      maxTokens <= 0
    )
      return {
        percentage: 0,
        usedLabel: '',
        leftPercentage: 0,
      }
    const pct = Math.min((usedTokens / maxTokens) * 100, 100)
    const fmt = (n: number) =>
      n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n)
    return {
      percentage: pct,
      usedLabel: `${fmt(usedTokens)} / ${fmt(maxTokens)} tokens used`,
      leftPercentage: Math.max(0, 100 - pct),
    }
  }, [usedTokens, maxTokens])

  if (usedLabel.length === 0) return null

  return (
    <PreviewCard>
      <PreviewCardTrigger
        className={cn(
          buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
          'text-[var(--theme-text)] hover:bg-[var(--theme-hover)]',
        )}
      >
        <div className="size-4 text-[var(--theme-muted)]">
          <svg
            viewBox="0 0 36 36"
            className="size-4 -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-[var(--theme-muted)]"
            />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              className="text-[var(--theme-muted)]"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${(percentage / 100) * 97.4} 97.4`}
            />
          </svg>
        </div>
      </PreviewCardTrigger>
      <PreviewCardPopup align="end" sideOffset={8} className="w-52 px-2 py-1">
        <div className="space-y-0.5 text-xs text-[var(--theme-text)]">
          <div className="text-[var(--theme-text)] font-[450]">Context window:</div>
          <div className="tabular-nums text-[var(--theme-muted)]">
            {percentage.toFixed(0)}% used ({leftPercentage.toFixed(0)}% left)
          </div>
          <div className="tabular-nums text-[var(--theme-muted)]">{usedLabel}</div>
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  )
}

export const ContextMeter = memo(ContextMeterComponent)
