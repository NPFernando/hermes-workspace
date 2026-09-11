import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ReactNode } from 'react'
import type {
  DashboardLayout,
  WidgetId,
} from '@/screens/dashboard/lib/use-dashboard-layout'
import { WIDGET_CATALOG } from '@/screens/dashboard/lib/use-dashboard-layout'

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
 */
export function WidgetShell({
  id,
  layout,
  children,
}: {
  id: WidgetId
  layout: DashboardLayout
  children: ReactNode
}) {
  if (!layout.isVisible(id)) return null

  const meta = WIDGET_CATALOG.find((w) => w.id === id)
  const canHide = meta?.hideable ?? true

  if (!layout.editMode) {
    // Plain passthrough. Wrapping in a fragment-equivalent div would
    // change the flexbox layout above us, so we skip the wrapper.
    return <>{children}</>
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
      <div className="relative h-full">{children}</div>
      {canHide ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            layout.hide(id)
          }}
          className="absolute -right-2 -top-2 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-danger)] shadow-md motion-safe:transition-transform motion-safe:hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0 lg:min-w-0 lg:size-6"
          title={`Hide ${meta?.label ?? id}`}
          aria-label={`Hide widget ${meta?.label ?? id}`}
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            size={13}
            strokeWidth={2}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  )
}
