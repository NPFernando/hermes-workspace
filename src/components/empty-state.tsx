/**
 * Phase 3.3: Reusable empty state component
 */
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from '@/lib/utils'

type EmptyStateProps = {
  icon: any
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-4 py-12 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-hover)]">
        <HugeiconsIcon
          icon={Icon}
          size={24}
          strokeWidth={1.5}
          className="text-[var(--theme-accent)]"
        />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--theme-text)]">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-[var(--theme-muted)] text-pretty">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
