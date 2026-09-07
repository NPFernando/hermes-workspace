import type { ReactNode } from 'react'
import type {DashboardLayout, WidgetId} from '@/screens/dashboard/lib/use-dashboard-layout';
import {

  WIDGET_CATALOG

} from '@/screens/dashboard/lib/use-dashboard-layout'
import { WidgetSkeleton } from '@/screens/dashboard/components/widget-skeleton'

/**
 * Wraps a dashboard widget so it participates in edit mode without
 * the widget itself needing to know edit state exists.
 *
 * Behavior:
 * - When `layout.editMode` is true: shows a subtle dashed outline +
 *   an X button in the top-right corner that hides the widget. The
 *   widget body remains interactive so the operator can still see
 *   what they're toggling.
 * - When edit mode is off: renders children unchanged (zero overhead
 *   layout-wise; the wrapper is just a passthrough div).
 *
 * If the widget is hidden (`!layout.isVisible(id)`), this returns
 * null in both modes — restoration happens through the EditPanel.
 *
 * When `loading` is true (first data load only — callers gate on
 * `isPending`, never `isFetching`), the widget body is replaced by a
 * shape-matched `<WidgetSkeleton>` so the grid doesn't reflow when the
 * real card mounts.
 */
export function WidgetShell({
  id,
  layout,
  loading = false,
  children,
}: {
  id: WidgetId
  layout: DashboardLayout
  loading?: boolean
  children: ReactNode
}) {
  if (!layout.isVisible(id)) return null

  const meta = WIDGET_CATALOG.find((w) => w.id === id)
  const canHide = meta?.hideable ?? true
  const body = loading ? <WidgetSkeleton id={id} /> : children

  if (!layout.editMode) {
    // Plain passthrough. Wrapping in a fragment-equivalent div would
    // change the flexbox layout above us, so we skip the wrapper.
    return <>{body}</>
  }

  // Use `h-full` on the edit-mode wrapper so children that opted
  // into `flex-1`/`h-full` (e.g. Sessions Intelligence post iter 013)
  // still expand correctly when the dashboard is in edit mode.
  return (
    <div className="relative h-full">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{
          outline: '1px dashed var(--theme-accent)',
          outlineOffset: '2px',
          boxShadow:
            '0 0 0 6px color-mix(in srgb, var(--theme-accent) 8%, transparent)',
          borderRadius: 12,
        }}
      />
      <div className="relative h-full">{body}</div>
      {canHide ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            layout.hide(id)
          }}
          className="absolute -right-2 -top-2 z-10 inline-flex size-6 items-center justify-center rounded-full text-[14px] font-bold leading-none shadow-md transition-transform hover:scale-110 bg-[var(--theme-card)] text-[var(--theme-danger)] border border-[var(--theme-border)]"
          title={`Hide ${meta?.label ?? id}`}
          aria-label={`Hide widget ${meta?.label ?? id}`}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
