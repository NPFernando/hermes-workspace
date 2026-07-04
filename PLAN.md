# Plan: Show scheduled-job health summary filter

## Summary of the change

Add a compact Jobs screen health filter so operators can quickly triage all jobs, stale jobs, failed jobs, paused jobs, and jobs that have never produced a run. The filter should expose counts, pressed state, and descriptive labels for keyboard and screen-reader users.

## Files to modify

- `src/screens/jobs/jobs-screen.tsx`
- `src/screens/jobs/jobs-screen.test.ts`

## Steps

1. Add exported helper types/functions in `jobs-screen.tsx` for job health filters, job classification, counts, and accessible filter labels.
2. Add a `healthFilter` state in `JobsScreen` and apply it after the existing text search filter.
3. Render compact filter buttons in the Jobs header with `aria-pressed`, counts, and descriptive labels.
4. Improve empty-state copy so filtered views explain whether no jobs match the text search or health filter.
5. Extend `jobs-screen.test.ts` with focused tests for the new helper copy, counts, and matching behavior.

## How to verify the change works

- `npx tsc --noEmit`
- `npx vitest run src/screens/jobs/jobs-screen.test.ts`
- `npx eslint --no-warn-ignored -f json src/screens/jobs/jobs-screen.tsx src/screens/jobs/jobs-screen.test.ts`
- `pnpm build`

## Rollback procedure

Revert the auto-improvement commit or remove the health-filter helper functions, header filter row, and related tests from the two modified Jobs screen files.
