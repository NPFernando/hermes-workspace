# Plan: Compact Tasks Operations Toolbar

## Summary of the change
Polish the Tasks workspace so frequent operational controls take less vertical space, avoid blocking browser prompts/confirmations, and keep slide-over panels mutually exclusive. This cycle uses the existing dirty `src/screens/tasks/tasks-screen.tsx` worktree change as the implementation candidate, then hardens it with TypeScript and lint fixes.

## Files to modify
- `src/screens/tasks/tasks-screen.tsx`
- `IDEAS.json`
- `PLAN.md`
- `TEST_REPORT.json`
- `CLOSE_SUMMARY.md`

## Steps
1. Replace separate panel booleans with one `activePanel` state for Activity, Tags, Sister Load, and Rebalance panels.
2. Compact the Tasks header statistics, toolbar buttons, and filter affordances so they fit better on constrained screens.
3. Replace `window.prompt` / `window.confirm` flows with inline inputs and React confirmation dialogs.
4. Pre-compute live panel and timeout-analysis data outside JSX-heavy render blocks.
5. Fix TypeScript and mechanical lint regressions introduced by the UI refactor.
6. Preserve unrelated dirty worktree entries (`services/odysseus` and untracked docs) unstaged.

## How to verify the change works
- `npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `pnpm test`
- `npx eslint --no-warn-ignored -f json --rule '@typescript-eslint/no-unnecessary-condition: off' src/screens/tasks/tasks-screen.tsx`
- `pnpm lint` for repository baseline visibility
- `git diff --check`
- `pnpm -s lint:class-tokens`
- `pnpm build`
- Restart `hermes-workspace.service` and validate `https://agent.fernandofamily.com/api/health` returns JSON `{"status":"ok"}` because a source file changed.

## Rollback procedure
Revert the auto-improvement commit or restore `src/screens/tasks/tasks-screen.tsx` from the previous commit, then rebuild/restart the workspace service and re-run the JSON health check.
