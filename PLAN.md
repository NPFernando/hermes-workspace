# Plan: Harden automated task execution and board status reporting

## Summary of the change
Improve Hermes workspace task execution reliability by adding VM-safe execution guards, clearer Telegram/operator visibility, and stricter readiness checks for planned review tasks. Add a lightweight `/api/telegram-board` route that can render or send a compact board status summary.

## Files to modify
- `src/server/astra-tasks.ts`
- `src/server/task-execution-utils.ts`
- `src/routes/api/telegram-board.ts`
- `src/routeTree.gen.ts`
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`
- `IDEAS.json`
- `PLAN.md`
- `TEST_REPORT.json`
- `CLOSE_SUMMARY.md`

## Steps
1. Preserve the existing idea backlog and append the execution-hardening, Telegram-board-summary, and stub-plan-readiness ideas without deleting prior entries.
2. Add task execution preflight and concurrency safeguards in `astra-tasks.ts` so background execution checks gateway/OpenRouter reachability, caps concurrent workers, and records deferrals instead of spawning blindly.
3. Add periodic operator visibility: daily board health summary, auto-execute sweep for aged real review plans, and long-running execution progress pings.
4. Add `/api/telegram-board` and route-tree registration so the workspace can return/send a formatted board status summary.
5. Centralize/document `parseWorkSummary` behavior in `task-execution-utils.ts` for future drift checks with the embedded subprocess parser.
6. Require substantive planned notes (>=80 chars and not `Plan unavailable`) before review tasks count as executable in UI and backend batch execution; update focused UX tests.
7. Verify with TypeScript, focused Tasks UX Vitest, focused ESLint, git diff whitespace check, full build, and JSON health validation after service restart.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH`
- `npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `npx eslint --no-warn-ignored -f json src/server/astra-tasks.ts src/server/task-execution-utils.ts src/routes/api/telegram-board.ts src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts`
- `git diff --check`
- `pnpm build`
- `sudo systemctl restart hermes-workspace.service`
- Validate `https://agent.fernandofamily.com/api/health` returns HTTP 200, `application/json`, and `{ "status": "ok" }`.

## Rollback procedure
Revert the auto-improvement commit, rebuild the workspace, restart `hermes-workspace.service`, and re-run the JSON health check.
