# Close Summary: Scheduled Job Stale-Run Copy

## What changed

- Added `formatJobFreshnessCopy` in `src/screens/jobs/jobs-screen.tsx` so active scheduled jobs now show concise copy when they have never run or have not run recently.
- Rendered the freshness copy directly on each Jobs card below the existing last-run status, using warning-colored text without changing paused or completed job cards.
- Expanded `src/screens/jobs/jobs-screen.test.ts` with focused coverage for never-run, recent-run, stale-run, paused, completed, and invalid-date job states.
- Preserved the existing idea backlog and appended follow-up ideas rather than replacing `IDEAS.json`.

## Test results

- PASS: `npx tsc --noEmit --pretty false`
- PASS: `npx vitest run src/screens/jobs/jobs-screen.test.ts` (6 tests)
- PASS: focused ESLint on `src/screens/jobs/jobs-screen.tsx` and `src/screens/jobs/jobs-screen.test.ts` (0 errors, 0 warnings)
- PASS: `git diff --check` on intended files
- PASS: `pnpm build`
- Baseline only: full `pnpm test` still exits 1 because pre-existing untracked `testCurrencyConversion.test.ts` is collected with no Vitest suite.
- Baseline only: full `pnpm lint` still exits 1 with repository-wide lint debt and unrelated root scratch-file parser issues.

## Deployment

- Restarted `hermes-workspace.service`; `systemctl is-active` returned `active`.
- Validated `https://agent.fernandofamily.com/api/health` with status `200`, content type `application/json`, and body `{"status":"ok"}`.
- Observed a systemd daemon-reload warning after restart, but did not run daemon-reload because this cycle did not touch service unit files and the mission forbids unnecessary daemon reloads.

## Side effects and boundaries

- Committed only intended Jobs screen/test and auto-improvement artifact files.
- Left pre-existing finance/package/docs/scratch dirty worktree changes unstaged.
- Did not push to any remote and did not create a PR, per mission instructions.

## New follow-up ideas

- Add a Jobs health summary filter for stale, failed, paused, and never-run jobs.
- Surface workspace service unit drift warnings in health/status UI.
- Quarantine root-level scratch test files from the default Vitest collection.
