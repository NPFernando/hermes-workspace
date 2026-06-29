# Plan: Improve compact task column labels

## Summary of the change
Improve Workspace Tasks compact/empty column affordances so mobile, keyboard, and screen-reader users get clearer action copy. Compact empty columns should expose a descriptive accessible region label and add-button label instead of relying on a rotated visual column name alone.

## Files to modify
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`

## Steps
1. Add exported helper copy functions for compact task column aria/summary text.
2. Use those helpers in the compact empty-column rendering path for `aria-label`, `title`, and add-button `aria-label`.
3. Preserve the visual compact column layout while adding a screen-reader-only hint.
4. Add focused Vitest coverage for the helper copy.
5. Verify TypeScript, focused Vitest, focused ESLint, build, full test/lint baseline, and JSON health after restart.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH`
- `npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `npx eslint --no-warn-ignored -f json src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts`
- `pnpm build`
- `pnpm test` and `pnpm lint` results recorded in `TEST_REPORT.json` with known baseline issues separated from focused regressions.

## Rollback procedure
Run `git -C /home/ubuntu/hermes-workspace revert HEAD` before deployment, or restore the two modified source/test files from the previous commit and rerun the focused verification commands.
