# Close Summary: Execute Ready batch action

## What changed
- Added an authenticated `/api/tasks-batch-execute` route that starts up to a bounded number of review-column tasks with usable plans.
- Added `batchExecuteTasks()` on the client and `batchExecuteBackground()` on the server, with staggered task starts to avoid a process thundering herd.
- Added a Tasks board `Execute Ready` button that appears only when planned review tasks are ready, shows loading feedback, and reports started/remaining counts via toast.
- Extracted `countExecutableReviewTasks()` and added focused UX-copy test coverage for ready-task eligibility.
- Preserved `IDEAS.json` and appended follow-up ideas instead of replacing the backlog.

## Files changed
- `IDEAS.json`
- `PLAN.md`
- `TEST_REPORT.json`
- `src/lib/tasks-api.ts`
- `src/routes/api/tasks-batch-execute.ts`
- `src/server/astra-tasks.ts`
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`
- `src/routeTree.gen.ts`

## Test results
Passing focused gates:
- `npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts` — 9 tests passed.
- `npx eslint --no-warn-ignored -f json ...changed files...` — 0 errors, 0 warnings.
- `git diff --check`
- `pnpm build`

Baseline limitations recorded in `TEST_REPORT.json`:
- Full `pnpm test` still exits non-zero because default Vitest collection includes Playwright E2E specs without `@playwright/test` and Odysseus TAP `.mjs` files with no Vitest suite.
- Full `pnpm lint` still reports repo-wide baseline lint debt outside the changed-file gate.

## Deployment and health
- Rebuilt production assets with `pnpm build`.
- Restarted `hermes-workspace.service`; `systemctl is-active` returned `active`.
- Health check used bounded retry and validated status, content type, and JSON body. First attempt returned transient nginx 502 during warm-up; final result: `200 application/json` with body `{"status":"ok"}`.

## Side effects / notes
- No push or PR was created; the mission explicitly says not to push.
- Existing dirty gitlink `services/odysseus` remains unstaged and untouched.
- Pre-existing unrelated work-in-progress snippets were not included in this commit; a pre-cleanup diff backup was saved at `/tmp/hermes-workspace-pre-autoimprove.diff` for audit during this cron run.

## New ideas for next cycle
- Show live progress after Execute Ready starts tasks.
- Add focused API tests for tasks batch execution.
- Fix the default Vitest collection baseline so E2E/TAP suites do not fail unit-test runs.
