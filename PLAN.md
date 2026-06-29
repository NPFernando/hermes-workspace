# Auto-Improvement Plan: Task Board Refresh Status Text

## Summary of the change
Add a subtle live refresh status message to the Workspace Tasks screen so users can tell when the board is initially loading or refetching in the background. This improves feedback for manual refreshes and automatic polling without changing backend behavior.

## Files to modify
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`

## Steps
1. Add an exported `formatTaskRefreshStatus` helper that returns stable user-facing copy for initial load and background refresh states.
2. Compute the refresh status from the TanStack Query task query state in `TasksScreen`.
3. Render the status in a small `role="status"` / `aria-live="polite"` region near the search/filter controls.
4. Make the refresh button call `tasksQuery.refetch()` directly, expose a stateful accessible label, and show a spinning icon while refreshing.
5. Extend the existing tasks UX copy tests to cover the new helper.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH`
- `npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `npx eslint --no-warn-ignored -f json src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts`
- `git diff --check`
- `pnpm build`
- If source changed, restart `hermes-workspace.service` and validate `/api/health` returns JSON `{ "status": "ok" }`.

## Rollback procedure
Revert the auto-improvement commit or remove the helper, status region, refresh-button state changes, and matching tests from the two modified source files.
