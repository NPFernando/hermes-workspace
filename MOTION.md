# Motion & Loading Standard

The house rules for animation in hermes-workspace. New motion should reuse
what's here rather than introduce one-off durations or curves. Aligns with
Material 3 motion, Apple HIG, and WCAG 2.3.3 / `prefers-reduced-motion`.

Tokens live in `src/styles.css` `:root` (**not** the `@theme` block — that one
is owned by upstream PR #673).

---

## 1. Easing curves — pick one of two

| Token | Curve | Use for |
|---|---|---|
| `var(--snappy)` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | Default. UI transitions, page enter, expand/collapse, hovers, tab underline. |
| `var(--spring)` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful entrances only — modals, message bubbles, domino cascades. Overshoots; do not use on frequent/repeating motion. |

Do not add new `cubic-bezier(...)` values. Linear is fine for indeterminate
loops (spinners, shimmer sweep).

## 2. Duration scale

| Token | Value | Use for |
|---|---|---|
| `var(--motion-fast)` | 150ms | Micro-interactions: hover, active/press, color/opacity swaps, small toggles. |
| `var(--motion-base)` | 220ms | Entrances, expand/collapse, route `page-enter`, drawers. |
| `var(--motion-slow)` | 320ms | Spring entrances (modals, first-mount cascades). Ceiling for one-shot UI motion. |
| `var(--motion-skeleton)` | 1.6s | Loop period for skeleton shimmer and the background-refresh bar. |

Anything longer than `--motion-slow` for a one-shot transition is a bug. In
Tailwind JSX, prefer `duration-150` / `duration-200` to match `fast` / `base`;
reach for the CSS tokens when a custom keyframe is involved.

## 3. Reduced motion — mandatory

Every keyframe animation **must** be named in one of the
`@media (prefers-reduced-motion: reduce)` blocks in `src/styles.css` (there are
8+; group with a related one, or add to the consolidated "Reduced-motion safety
net" block after `[data-route-page]`). The block sets `animation: none` and, for
shimmer-type effects, swaps in a static tint. A keyframe not covered there is
the one animation that keeps moving for users who asked it to stop — treat a
missing entry as a failing review.

**Exception — functional loading indicators keep moving.** `.spinner-accent`
and the shimmer skeletons are intentionally *not* frozen under reduced motion:
a stalled progress indicator reads as a broken UI. This is the WCAG 2.2.2
"essential animation" carve-out. Everything decorative (pulses, glows, shine,
wiggle, entrance transforms) stops.

JS side: use framer-motion's `useReducedMotion()` (already in-tree at
`src/components/agent-view/agent-view-panel.tsx`). Do not add a new hook.

## 4. Loading states

### Skeleton, not spinner, for content areas
- Use `<Skeleton>` (`src/components/ui/skeleton.tsx`) — single block, or
  `count={n}` for stacked text lines. It rides `.skeleton-shimmer` (theme-aware,
  reduced-motion-safe).
- `spinner-accent` / `animate-spin` icons are for **buttons and inline
  actions**, not for a card or panel that's fetching its data.
- Legacy: `src/components/Skeleton.tsx` (hard-coded grey) is **deleted** — don't
  reintroduce it. `.animate-shimmer` is gone. There is one `@keyframes shimmer`.

### First load vs. background refetch — the rule that matters
- Skeletons render on **first load only**: gate on React Query `isPending`,
  **never `isFetching`**. A skeleton that reappears on a 30s poll or a filter
  change is a regression.
- Give re-fetching queries `placeholderData: keepPreviousData` so the previous
  result stays on screen during the fetch.
- Signal a background refresh with a low-key affordance — the `.refresh-bar`
  (2px sweeping top-edge bar) or a small spinning refresh icon — not a skeleton.

Reference implementation: `src/screens/dashboard/dashboard-screen.tsx` +
`components/widget-shell.tsx` (the `loading?` prop) +
`components/widget-skeleton.tsx` (per-widget shapes so the grid doesn't reflow).

### Route transitions
- Add `data-route-page` to a screen's root element; it gets
  `page-enter 0.22s var(--snappy)` automatically. That's the whole mechanism —
  no per-route `AnimatePresence`. Every `*-screen.tsx` carries it **except
  `chat-screen.tsx`**, which is deliberately excluded — its own message-list
  scroll/layout fights a page-level transform.

## 5. What not to do

- No new easing curves or magic-number durations.
- No `animate-pulse` flat blocks for skeletons — use `<Skeleton>`.
- No skeleton keyed on `isFetching`.
- No keyframe without a `prefers-reduced-motion` entry.
- No animation over `--motion-slow` for one-shot UI motion.
- Don't animate `width` / `height` / `top` / `left` where `transform` works.

## Note on "OS animation standards"

Compositor setups like Omarchy / Hyprland tune *window-manager* motion (window
open, workspace switch) via bézier + decisecond durations. That's a different
layer from web component motion and has no portable spec — but the principle is
identical to this doc: one shared curve set, short durations, consistency over
variety. This file is that principle applied to the workspace UI.
