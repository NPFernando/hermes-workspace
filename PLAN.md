# Plan: Harden mobile viewport sizing and touch ergonomics

## Summary of the change
Adopt dynamic viewport height units across workspace dialogs, drawers, image previews, chat panels, dashboards, jobs, gateway, memory, skills, swarm, and task surfaces so browser chrome on mobile no longer clips panel content. Add touch-only global CSS for minimum readable tiny labels, overscroll containment in nested scroll containers, and immediate press feedback for touch targets.

## Files to modify
- `src/**/*.tsx` components and routes that use `max-h-[...vh]`, `h-[...vh]`, or `min-h-[...vh]` for modal/drawer/panel sizing.
- `src/styles.css` for touch-only ergonomic fallbacks.

## Steps
1. Preserve the existing responsive worktree changes on `feature/chat-ui-improvements`; do not discard unrelated coherent UI changes.
2. Convert fixed viewport-height Tailwind utilities in workspace source files from `vh` to `dvh` where dynamic mobile browser chrome matters.
3. Add `@media (hover: none) and (pointer: coarse)` CSS rules for readable small arbitrary text utilities, nested scroller overscroll containment, and touch active feedback.
4. Keep screenshot smoke artifacts untracked; do not stage them in this cycle.
5. Run TypeScript, Vitest, lint/build gates, then commit only intended source files plus cycle artifacts.

## How to verify the change works
- `git diff --check`
- `npx tsc --noEmit`
- `pnpm test`
- `pnpm lint` and, if repository-wide baseline fails, focused ESLint on changed TypeScript/TSX files plus documentation of baseline failures.
- `pnpm build`
- JSON body health check after restart only if source changes are deployed.

## Rollback
Revert the auto-improve commit on `feature/chat-ui-improvements` or restore the touched `src/` files from the previous commit. Restart `hermes-workspace.service` only if a deployed build was rolled back.
