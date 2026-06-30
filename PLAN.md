# Plan — Task operations visibility and large-board performance

## Summary of the change
Improve the Workspace Tasks board for operational control: virtualize large task lists, expose batch/task execution outcome telemetry, add routes for sweep/drain/rescue/replan status, and surface richer Telegram board summaries.

## Files to modify
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/task-card.tsx`
- `src/server/astra-tasks.ts`
- `src/routes/api/tasks-completion-trend.ts`
- `src/routes/api/tasks-drain-now.ts`
- `src/routes/api/tasks-replan-stubs.ts`
- `src/routes/api/tasks-rescue-timedout.ts`
- `src/routes/api/tasks-stale.ts`
- `src/routes/api/tasks-sweep-stats.ts`
- `src/routes/api/telegram-board.ts`
- `src/routeTree.gen.ts`
- `package.json`, `pnpm-lock.yaml`

## Steps
1. Preserve useful existing dirty task-board work and discard unrelated/broken package/finance draft changes from the active source tree.
2. Add `@tanstack/react-virtual` and render large task columns through virtualized rows while keeping small columns unchanged.
3. Add task operation endpoints for sweep stats, stale/timed-out rescue, stub replan, completion trend, and manual drain.
4. Surface task activity, selection, compact rows, progress/summary panels, and richer Telegram board outcome text.
5. Fix TypeScript issues discovered during verification: route activity entries need full metadata, drag-end is a supported TaskCard prop, sweep stats must be declared before effects use it, and panel notes should use `agent_comment`.
6. Verify with TypeScript, focused Tasks tests, full Vitest, focused lint fallback, and production build.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH`
- `npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts --reporter=dot`
- `pnpm test`
- `npx eslint --no-warn-ignored -f json --rule '@typescript-eslint/no-unnecessary-condition: off' <changed task files>`
- `pnpm build`
- Restart `hermes-workspace.service` and verify both systemd state and JSON health.

## Rollback procedure
Revert the auto-improvement commit, run `pnpm install` to restore the dependency graph, rebuild, restart `hermes-workspace.service`, and validate `/api/health` returns JSON `{"status":"ok"}`.
