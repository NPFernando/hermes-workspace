# Plan: Show scheduled job stale-run copy

## Summary of the change

Add helper-tested copy on Jobs cards that surfaces when enabled scheduled jobs have never run or have not run recently. This makes dormant schedules visibly different from healthy recurring jobs without requiring operators to inspect run history.

## Files to modify

- `src/screens/jobs/jobs-screen.tsx`
- `src/screens/jobs/jobs-screen.test.ts`
- `IDEAS.json`
- `PLAN.md`
- `TEST_REPORT.json`
- `CLOSE_SUMMARY.md`

## Steps

1. Export a small helper from `jobs-screen.tsx` that formats stale-run status copy from a job's enabled/state/last-run fields and an injectable current time.
2. Render the helper output below the existing last-run status line when it returns copy.
3. Add focused Vitest tests for never-run, recent-run, stale-run, paused, and invalid-date cases.
4. Run TypeScript, focused tests, focused lint, build, and deployment health validation.
5. Preserve unrelated dirty worktree files unstaged.

## How to verify the change works

- `npx tsc --noEmit --pretty false`
- `npx vitest run src/screens/jobs/jobs-screen.test.ts`
- `npx eslint --no-warn-ignored -f json src/screens/jobs/jobs-screen.tsx src/screens/jobs/jobs-screen.test.ts`
- `pnpm build`
- `sudo systemctl restart hermes-workspace.service` followed by JSON health validation for `/api/health`.

## Rollback procedure

Revert the local auto-improve commit or remove the helper/render block and the associated tests, then rerun the same verification commands.
