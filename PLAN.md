# Plan: Add sidebar session loading states with skeleton placeholders

## Summary

The chat sidebar's Sessions section currently shows a plain one-line
"Loading sessions…" text while the session list is being fetched. Replace
that with compact skeleton placeholder rows that mirror the `SessionItem`
layout (title line + subtitle line, `h-14` row height) using the
workspace's standard `animate-pulse` loading pattern. This gives users a
stable, non-jumping placeholder during initial fetch and matches the visual
rhythm of the sidebar while data loads.

## Files to modify

1. **`src/screens/chat/components/sidebar/sidebar-sessions.tsx`**
   - Add an inline `SessionItemSkeleton` component that renders 3 skeleton
     rows matching the `SessionItem` layout:
     - Row: `flex items-center h-14 rounded-lg px-1.5`
     - Title line: `h-3.5 w-3/5 rounded bg-[var(--theme-hover)] animate-pulse`
     - Subtitle line: `h-2.5 w-2/5 rounded mt-2 bg-[var(--theme-hover)] animate-pulse`
     - Wrap rows in a container with `aria-busy="true"` and
       `aria-label="Loading sessions"` for assistive tech.
   - Replace the current `loading ? (...Loading sessions…)` branch with the
     skeleton rows.
   - Also render skeletons when `fetching && sessions.length === 0` (the
     first background refresh with no data yet), so the section never shows
     a blank flash.

## Test cases to verify

- `npx tsc --noEmit` exits 0 (Node 22 via Hermes-managed Node PATH).
- Focused Vitest run for the sidebar loading helper passes.
- Focused ESLint on the changed file reports 0 errors.
- `pnpm build` succeeds.
- `git diff --check` clean.

## Rollback procedure

- The change is confined to one source file (`sidebar-sessions.tsx`).
  Revert with `git checkout -- src/screens/chat/components/sidebar/sidebar-sessions.tsx`
  and restart `hermes-workspace.service`.
