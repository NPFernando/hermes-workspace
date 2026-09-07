import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Skeleton — the single loading-placeholder primitive.
 *
 * Renders a theme-aware sweeping shimmer via the `.skeleton-shimmer` utility
 * in `src/styles.css` (which is already covered by a
 * `@media (prefers-reduced-motion: reduce)` block — it flattens to a static
 * tint there). Decorative, so `aria-hidden`; put the visible
 * `role="status"` / `aria-busy` on the container that swaps skeleton ↔ content.
 *
 * Two shapes:
 * - default: one block. Size it with `className` (`h-*`, `w-*`, `rounded-*`).
 * - `count={n}`: a stacked run of `n` lines (for text blocks / list rows),
 *   the last line shortened. `lineClassName` styles each line.
 */
interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render a stack of `count` lines instead of a single block. */
  count?: number
  /** Per-line classes when `count` is set. */
  lineClassName?: string
}

function Skeleton({ className, count, lineClassName, ...props }: SkeletonProps) {
  if (count && count > 0) {
    return (
      <div
        aria-hidden
        data-slot="skeleton"
        className={cn('flex flex-col gap-2', className)}
        {...props}
      >
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className={cn(
              'skeleton-shimmer h-3 rounded',
              i === count - 1 && 'w-3/5',
              lineClassName,
            )}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn('skeleton-shimmer rounded-lg', className)}
      {...props}
    />
  )
}

export { Skeleton }
export type { SkeletonProps }
