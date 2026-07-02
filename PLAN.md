# Plan: Keep Tasks Header Stats Readable

## Summary of the change

The compact Tasks header stat row can include multi-word stats such as `22 blocked (needs input)` and `3 overdue`. The previous mobile-only horizontal scrolling behavior kept the row on one line, but made the header harder to scan on narrow screens. This cycle keeps each stat phrase atomic with `whitespace-nowrap` while allowing the row itself to wrap naturally.

## Files to modify

- `src/screens/tasks/format-utils.ts`
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`

## Steps

1. Export a named `TASK_STATS_ROW_CLASS` from `format-utils.ts` so the responsive stat-row behavior has a single tested source of truth.
2. Use `TASK_STATS_ROW_CLASS` in `tasks-screen.tsx` for the Tasks header stats row.
3. Add a focused Tasks UX unit test asserting the row wraps stat units, preserves `whitespace-nowrap`, and does not reintroduce horizontal scrolling.
4. Stage and commit only the intended Tasks source/test files and auto-improvement artifacts; leave unrelated dirty finance, docs, scratch, and gitlink changes unstaged.

## How to verify the change works

- `npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `npx eslint --no-warn-ignored -f json --rule '@typescript-eslint/no-unnecessary-condition: off' src/screens/tasks/format-utils.ts src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts`
- `pnpm lint:class-tokens`
- `pnpm build`
- Restart `hermes-workspace.service` and validate `https://agent.fernandofamily.com/api/health` returns JSON `{"status":"ok"}`.

## Rollback procedure

Revert the auto-improvement commit or restore the stat-row class to the previous inline value in `tasks-screen.tsx`, then rerun TypeScript and focused Tasks UX tests.
