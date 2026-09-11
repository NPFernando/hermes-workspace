import { useState } from 'react'
import type { DashboardLayout } from '@/screens/dashboard/lib/use-dashboard-layout'
import { WIDGET_CATALOG } from '@/screens/dashboard/lib/use-dashboard-layout'
import { ConfirmDialog } from '@/components/confirm-dialog'

/**
 * Edit-mode banner. Renders only when `layout.editMode` is true.
 *
 * Layout: a single sticky-ish strip below the header showing all
 * known widgets grouped by column (Main / Side rail) with a toggle
 * pill for each. Hidden widgets show as outlined chips so the
 * operator can re-add them.
 *
 * Design notes:
 * - We deliberately surface every widget here even ones that are
 *   currently visible, so it doubles as a hint of what's available.
 * - The banner is dense (single row on lg) so it doesn't push the
 *   real content way down.
 */
export function EditModePanel({ layout }: { layout: DashboardLayout }) {
  const [confirmReset, setConfirmReset] = useState(false)

  if (!layout.editMode) return null

  const main = WIDGET_CATALOG.filter((w) => w.column === 'main')
  const rail = WIDGET_CATALOG.filter((w) => w.column === 'rail')
  const persistenceLabel =
    layout.persistenceStatus === 'saved'
      ? 'saved locally'
      : layout.persistenceStatus === 'unavailable'
        ? 'not saved · this session only'
        : 'saving…'
  const persistenceShortLabel =
    layout.persistenceStatus === 'saved'
      ? 'saved'
      : layout.persistenceStatus === 'unavailable'
        ? 'not saved'
        : 'saving…'

  return (
    <section
      id="dashboard-layout-controls"
      aria-label="Dashboard layout controls"
      className="relative flex scroll-mt-[calc(4rem+env(safe-area-inset-top,0px))] flex-col gap-3 overflow-hidden rounded-xl border p-3 pb-[calc(var(--tabbar-h,80px)+0.75rem)] md:pb-3"
      style={{
        background:
          'linear-gradient(120deg, color-mix(in srgb, var(--theme-accent) 6%, var(--theme-card)), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-accent)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="sr-only" aria-live="polite">
            Dashboard layout edit mode. {layout.counts.visible} of{' '}
            {layout.counts.total} widgets shown.
          </span>
          <span
            className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{
              background:
                'color-mix(in srgb, var(--theme-accent) 18%, transparent)',
              color: 'var(--theme-accent)',
            }}
          >
            Edit mode
          </span>
          <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            <span className="sm:hidden">
              {layout.counts.visible}/{layout.counts.total} shown
            </span>
            <span className="hidden sm:inline">
              {layout.counts.visible} of {layout.counts.total} widgets shown
            </span>
          </span>
          <span
            className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--theme-muted)] sm:hidden"
            aria-live="polite"
          >
            {persistenceShortLabel}
          </span>
          <span
            className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--theme-muted)] sm:inline"
            aria-live="polite"
          >
            · {persistenceLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            aria-label="Restore default dashboard layout"
            className="min-h-11 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] motion-safe:transition-colors hover:bg-[var(--theme-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] bg-[var(--theme-card)] border-[var(--theme-border)] text-[var(--theme-text)] lg:min-h-0"
            title="Restore the default dashboard layout"
          >
            <span className="sm:hidden">Reset</span>
            <span className="hidden sm:inline">Restore defaults</span>
          </button>
          <button
            type="button"
            onClick={() => layout.setEditMode(false)}
            className="min-h-11 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
            style={{
              background:
                'linear-gradient(135deg, var(--theme-accent), color-mix(in srgb, var(--theme-accent) 60%, transparent))',
              color: 'var(--theme-on-accent, white)',
            }}
            title="Exit edit mode"
          >
            Done
          </button>
        </div>
      </div>

      {layout.counts.visible === 0 ? (
        <p
          role="status"
          className="rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed text-[var(--theme-muted)]"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          All dashboard widgets are hidden. Restore defaults to repopulate the
          workspace, or select individual widgets below.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Group title="Main column" layout={layout} widgets={main} />
        <Group title="Side rail" layout={layout} widgets={rail} />
      </div>
      {confirmReset ? (
        <ConfirmDialog
          title="Restore the default dashboard layout?"
          body="Your current widget visibility choices will be replaced with the default layout."
          confirmLabel="Restore defaults"
          danger={false}
          onConfirm={() => {
            layout.reset()
            setConfirmReset(false)
          }}
          onCancel={() => setConfirmReset(false)}
        />
      ) : null}
    </section>
  )
}

function Group({
  title,
  layout,
  widgets,
}: {
  title: string
  layout: DashboardLayout
  widgets: typeof WIDGET_CATALOG
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {widgets.map((w) => {
          const visible = layout.isVisible(w.id)
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => (visible ? layout.hide(w.id) : layout.show(w.id))}
              aria-pressed={visible}
              aria-label={`${visible ? 'Hide' : 'Show'} ${w.label}: ${w.description}`}
              className="group inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] motion-safe:transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
              style={{
                background: visible
                  ? 'color-mix(in srgb, var(--theme-success) 14%, transparent)'
                  : 'transparent',
                border: `1px ${visible ? 'solid' : 'dashed'} ${
                  visible
                    ? 'color-mix(in srgb, var(--theme-success) 60%, transparent)'
                    : 'var(--theme-border)'
                }`,
                color: visible ? 'var(--theme-success)' : 'var(--theme-muted)',
              }}
              title={w.description}
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{
                  background: visible
                    ? 'var(--theme-success)'
                    : 'var(--theme-muted)',
                }}
              />
              {w.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
