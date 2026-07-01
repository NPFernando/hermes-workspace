# Plan: Reduce Tasks screen focused ESLint shadowing debt

## Summary
Clean up low-risk `no-shadow` lint debt in the Workspace Tasks screen so the focused fallback lint gate can run with only the known baseline `@typescript-eslint/no-unnecessary-condition` rule disabled. This reduces ad-hoc verification noise for future Tasks UI cycles without changing runtime behavior.

## Files to modify
- `src/screens/tasks/tasks-screen.tsx`
- `IDEAS.json`
- `PLAN.md`
- `TEST_REPORT.json`
- `CLOSE_SUMMARY.md`

## Steps
1. Inspect the current focused lint output for `src/screens/tasks/tasks-screen.tsx`.
2. Rename the grouped todo column local variable so it no longer shadows an outer `columnMap` binding.
3. Rename the activity notification click-handler selected task local so it no longer shadows callback variables.
4. Run TypeScript and a focused ESLint gate on the touched Tasks screen with the known baseline `@typescript-eslint/no-unnecessary-condition` rule disabled.
5. Run broader test/lint/build checks, documenting repository-wide baseline failures separately from changed-file regressions.
6. Commit only intended files on `main` without pushing.
7. Because a `src/` file changed, build, restart `hermes-workspace.service`, and validate service state plus JSON health body shape.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`
- `npx eslint --no-warn-ignored -f json --rule '@typescript-eslint/no-unnecessary-condition: off' src/screens/tasks/tasks-screen.tsx` reports 0 errors and 0 warnings.
- `git diff --check`
- `pnpm -s lint:class-tokens`
- `pnpm build`
- `systemctl is-active hermes-workspace.service`
- `https://agent.fernandofamily.com/api/health` returns HTTP 200, `application/json`, and `{"status":"ok"}`.

## Rollback procedure
Revert the auto-improvement commit with `git revert <commit>` and restart `hermes-workspace.service` if the deployed UI needs to be rolled back.
