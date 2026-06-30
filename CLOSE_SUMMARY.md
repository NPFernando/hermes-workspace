# Close Summary: Harden task execution visibility

## What changed
- Added task execution safeguards in `src/server/astra-tasks.ts`: configurable free default model for first execution, gateway/OpenRouter preflight checks, max-concurrency deferral, auto-breakdown for exhausted blocked tasks, daily board-health summary, aged-review auto-execute sweep, and long-running execution progress pings.
- Added `/api/telegram-board` in `src/routes/api/telegram-board.ts` with generated route-tree registration so operators can fetch or send a compact Telegram board status summary.
- Added `src/server/task-execution-utils.ts` as the canonical TypeScript reference for `parseWorkSummary` behavior used by embedded execution subprocesses.
- Tightened executable review-task readiness in both UI and backend batch execution: tasks now need a real planned note of at least 80 characters and must not be `Plan unavailable`.
- Updated `src/screens/tasks/tasks-ux.test.ts`, `IDEAS.json`, `PLAN.md`, and `TEST_REPORT.json` for this cycle.

## Test results
Passed focused gates:
- `npx tsc --noEmit` — passed before and after commit.
- `npx vitest run src/screens/tasks/tasks-ux.test.ts` — 9 tests passed.
- Focused ESLint on changed source/test files — 0 errors, 0 warnings.
- `git diff --check` — passed.
- `pnpm build` — passed.

Baseline checks recorded in `TEST_REPORT.json`:
- `pnpm test` remains non-zero because Vitest collects Playwright E2E specs without `@playwright/test` and Odysseus TAP `.mjs` files with no Vitest suite; 723 assertions passed.
- `pnpm lint` remains non-zero due to existing repo-wide lint debt outside the focused changed-file gate.

## Deployment and health
Because workspace source files changed, I rebuilt the app, restarted `hermes-workspace.service`, and validated the external health endpoint with body-shape checking. Initial restart hit an `EADDRINUSE` condition from an orphaned user-owned `node server-entry.js` process on port 3000. I stopped that stale process, reset the failed systemd state, started `hermes-workspace.service`, and revalidated. Final state: service `active`; health result HTTP 200, `application/json`, body `{ "status": "ok" }`.

## Side effects / blockers
- No remote push or PR was created; mission explicitly says not to push.
- Local `main` is intentionally ahead of `origin/main`; this cycle committed locally only.
- Pre-existing dirty gitlink `services/odysseus` was left unstaged and untouched.
- Restart recovery required stopping one stale user-owned workspace Node process that was blocking port 3000; the managed systemd service is now active.

## New improvement ideas fed forward
- Fix the default Vitest include/exclude configuration so Playwright and TAP suites do not fail unit-test collection.
- Add focused tests for `/api/telegram-board` message formatting and failure handling.
- Add a drift check that compares `parseWorkSummary` embedded subprocess copies against `src/server/task-execution-utils.ts`.
