# Plan: Execute Ready batch action for planned review tasks

## Summary of the change
Add a small Tasks board action that lets the operator execute up to five review-column tasks that already have real plans. The backend exposes an authenticated batch endpoint that starts existing Hermes task execution with a concurrency cap and returns how many tasks started and how many remain.

## Files to modify
- `src/lib/tasks-api.ts`
- `src/routes/api/tasks-batch-execute.ts`
- `src/server/astra-tasks.ts`
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`
- `src/routeTree.gen.ts`

## Steps
1. Preserve the existing idea backlog and append the batch-execution idea without deleting prior entries.
2. Add `batchExecuteTasks()` to the client task API.
3. Add `/api/tasks-batch-execute` with authentication, a bounded `limit`, and optional explicit task IDs.
4. Add `batchExecuteBackground()` on the server to select review tasks with usable plans, stagger starts, and return `{ started, remaining }`.
5. Extract shared UI readiness logic into `countExecutableReviewTasks()` and cover it with focused Vitest tests.
6. Render an `Execute Ready` button only when at least one review task is executable; show loading and toast feedback.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH`
- `npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `npx eslint --no-warn-ignored -f json src/lib/tasks-api.ts src/routes/api/tasks-batch-execute.ts src/server/astra-tasks.ts src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts`
- `git diff --check`
- `pnpm build`
- Restart `hermes-workspace.service` because source files changed, then validate `/api/health` returns JSON `{ "status": "ok" }`.

## Rollback procedure
Revert the auto-improvement commit, rebuild the workspace, restart `hermes-workspace.service`, and re-run the JSON health check.
