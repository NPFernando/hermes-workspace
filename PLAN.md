# Plan: Show task dependencies and blocked-state causes

## Summary of the change
Make the Workspace Tasks board more actionable by surfacing why work is blocked and when tasks are waiting for prerequisites. The cycle uses the existing dirty worktree candidate and hardens it with typed helpers, focused UX tests, and a cost-safe retry fallback.

## Files to modify
- `src/lib/tasks-api.ts` — include optional `depends_on` in the client task type.
- `src/server/tasks-store.ts` — persist task dependencies in normalized records.
- `src/server/astra-tasks.ts` — skip dependency-blocked tasks during Deploy, auto-archive stale inactive tasks, clarify `needs_input` routing, and use a configurable free default retry model.
- `src/screens/tasks/task-card.tsx` — show a typed prerequisite chip for tasks with dependencies.
- `src/screens/tasks/tasks-screen.tsx` — split blocked stats into input-needed and execution-error labels.
- `src/screens/tasks/tasks-ux.test.ts` — cover the new helper copy.
- `IDEAS.json`, `TEST_REPORT.json`, `CLOSE_SUMMARY.md` — tracked cycle artifacts.

## Steps
1. Preserve existing idea backlog and append de-duplicated candidates for this cycle.
2. Add `depends_on` to task data types and persistence normalization.
3. Render dependency chips without `any` casts and add helper-tested copy.
4. Split blocked task counts into waiting-for-input versus execution-failure causes.
5. Keep retry escalation configurable and free-by-default to respect cost controls.
6. Run TypeScript, focused Vitest, focused ESLint, full test/lint baselines, build, and JSON health validation.
7. Commit only intended files on the current branch and do not push.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx eslint --no-warn-ignored -f json src/screens/tasks/task-card.tsx src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts src/lib/tasks-api.ts src/server/astra-tasks.ts src/server/tasks-store.ts`
- `git diff --check`
- `pnpm build`, service restart, and `/api/health` JSON body validation because `src/` changed.

## Rollback procedure
Revert the local `auto-improve: task dependency blocked status clarity` commit, rebuild, restart `hermes-workspace.service`, and rerun the JSON health check.
