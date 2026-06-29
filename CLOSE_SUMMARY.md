# Close Summary: Task dependency and blocked-state clarity

## What changed
- Added typed `depends_on` support to task API/client records and store normalization so dependency metadata survives round-trips.
- Updated the task deploy sweep to skip tasks whose prerequisites are not done yet, keeping dependent work silent in todo/backlog instead of wasting agent cycles.
- Added task card prerequisite chips such as “waiting on 2 prerequisites” and focused helper tests for the singular/plural copy.
- Split blocked board stats into input-needed versus execution-error causes, with helper-tested labels and title text.
- Hardened task-agent retry behavior so retry model escalation is configurable and free-by-default instead of hardcoding a paid model.
- Preserved the existing idea backlog and appended this cycle's follow-up candidates.

## Files changed
- `src/lib/tasks-api.ts`
- `src/server/tasks-store.ts`
- `src/server/astra-tasks.ts`
- `src/screens/tasks/task-card.tsx`
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`
- `IDEAS.json`, `PLAN.md`, `TEST_REPORT.json`, `CLOSE_SUMMARY.md`

## Test results
- PASS: `npx tsc --noEmit`
- PASS: `npx vitest run src/screens/tasks/tasks-ux.test.ts` (8 tests)
- PASS: focused changed-file ESLint, 0 errors / 0 warnings
- PASS: `git diff --check`
- PASS: `pnpm build`
- Baseline only: full `pnpm test` still exits non-zero due Vitest collecting Playwright E2E specs without `@playwright/test` and Odysseus TAP `.mjs` files with no Vitest suite.
- Baseline only: full `pnpm lint` still reports repo-wide lint debt outside the touched files.

## Deployment / health
- PASS: `pnpm build` completed before restart.
- PASS: `sudo systemctl restart hermes-workspace.service` completed and `systemctl is-active hermes-workspace.service` returned `active`.
- PASS: bounded `/api/health` validation returned HTTP 200, `application/json`, and body `{"status":"ok"}`.

## Side effects observed
No external repositories were touched and no remote push was performed. The pre-existing dirty `services/odysseus` gitlink was left unstaged.

## Follow-up ideas
- Fix the default Vitest include/exclude baseline so E2E and TAP suites do not fail unit-test collection.
- Add UI controls to manage task dependencies directly from the task dialog.
- Add a small operator tooltip explaining why dependency-waiting tasks are skipped by Deploy.
