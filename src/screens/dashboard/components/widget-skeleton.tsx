import type { ReactNode } from 'react'
import type { WidgetId } from '@/screens/dashboard/lib/use-dashboard-layout'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * First-load placeholder for a dashboard widget, keyed by `WidgetId` so each
 * slot reserves a plausible shape/height and the grid doesn't reflow when real
 * data arrives. Rendered by `WidgetShell` when `loading` is true — never on
 * background refetch (see dashboard-screen: gated on `isPending`, not
 * `isFetching`).
 *
 * The outer wrapper carries the visible `role="status"`; the `<Skeleton>`
 * blocks themselves are `aria-hidden`.
 */

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      aria-label="Loading widget"
      className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4"
    >
      {children}
    </div>
  )
}

export function WidgetSkeleton({ id }: { id: WidgetId }) {
  switch (id) {
    case 'analytics_chart':
      return (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-6 w-40 rounded-full" />
          </div>
          <Skeleton className="h-56 w-full rounded-lg" />
        </Card>
      )

    case 'top_models':
    case 'provider_mix':
    case 'cost_ledger':
      return (
        <Card>
          <Skeleton className="mb-3 h-4 w-28" />
          <Skeleton count={4} lineClassName="h-4" />
        </Card>
      )

    case 'cache_efficiency':
    case 'velocity':
      return (
        <Card>
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-8 w-20" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </Card>
      )

    case 'sessions_intelligence':
    case 'logs_tail':
      return (
        <Card>
          <Skeleton className="mb-3 h-4 w-36" />
          <Skeleton count={6} lineClassName="h-5" />
        </Card>
      )

    case 'operator_tip':
      return (
        <Card>
          <Skeleton count={2} lineClassName="h-3" />
        </Card>
      )

    case 'proactive_suggestions':
    case 'achievements':
    case 'skills_usage':
      return (
        <Card>
          <Skeleton className="mb-3 h-4 w-32" />
          <Skeleton count={3} lineClassName="h-6" />
        </Card>
      )

    case 'mix_rhythm':
      return (
        <Card>
          <Skeleton className="mb-3 h-4 w-28" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </Card>
      )

    default:
      return (
        <Card>
          <Skeleton className="mb-3 h-4 w-28" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </Card>
      )
  }
}
