# Plan: Clear Task Filter Result Summary Copy

## Summary of the change

Improve the Tasks screen filter status copy so operators can tell the difference between partial matches and zero-match filters at a glance. The change adds a small exported formatter with unit coverage and uses it in the Tasks filter bar.

## Files to modify

- `src/screens/tasks/tasks-screen.tsx` — add a tested filter-summary formatter and use it in the active-filter match counter.
- `src/screens/tasks/tasks-ux.test.ts` — cover pluralization, partial-match, and zero-match copy.

## Steps

1. Add `formatTaskFilterSummary(matchCount, totalTasks)` near the existing Tasks screen UX constants.
2. Return clear copy for all, partial, zero-match, and empty-board cases.
3. Replace the inline `Showing {matchCount} of {totalTasks}` text in the filter bar with the formatter.
4. Extend `tasks-ux.test.ts` with focused expectations for the formatter.

## How to verify the change works

- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx eslint -f json src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts`
- `git diff --check`

## Rollback procedure

Revert the changes in `src/screens/tasks/tasks-screen.tsx` and `src/screens/tasks/tasks-ux.test.ts`, then rerun the same verification commands.
