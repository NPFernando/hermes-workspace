/**
 * Shared route-level pending fallback.
 *
 * Wired as the router's `defaultPendingComponent` (see `src/router.tsx`) so
 * every route with a loader gets a consistent hold state, and reused by the
 * few routes that name their own `pendingComponent` with a specific label.
 *
 * `.spinner-accent` deliberately keeps spinning under `prefers-reduced-motion`
 * — a frozen progress indicator reads as broken (WCAG 2.2.2 essential
 * carve-out). See MOTION.md.
 */
export function RoutePending({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="flex h-full items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="text-center">
        <div className="spinner-accent spinner-xl mb-3" />
        <p className="text-sm text-[var(--theme-muted)]">{label}</p>
      </div>
    </div>
  )
}
