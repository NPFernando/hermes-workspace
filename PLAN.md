# Plan: Respect reduced motion and touch/mobile ergonomics

## Summary of the change
Improve mobile and accessibility ergonomics in `~/hermes-workspace` by keeping the existing touch-accessibility implementation in the dirty worktree: global reduced-motion CSS, global `touch-action: manipulation` for coarse pointers, touch-friendly button classes, a mobile Files screen tree/detail toggle, and terminal viewport padding above the mobile tab bar.

## Files to modify
- `src/styles.css`
- `src/components/workspace-shell.tsx`
- `src/components/mobile-tab-bar.tsx`
- `src/screens/files/files-screen.tsx`
- Touch affordance class updates across `src/components/**` and `src/screens/**`
- Mission artifacts: `IDEAS.json`, `PLAN.md`, `TEST_REPORT.json`, `CLOSE_SUMMARY.md`

## Steps
1. Preserve the current source changes that add reduced-motion behavior and touch ergonomics.
2. Verify the Files screen mobile tree/detail toggle compiles and keeps desktop layout via `md:*` classes.
3. Verify the terminal surface no longer extends behind the mobile tab bar when the tab bar is visible.
4. Run TypeScript, tests, lint/build gates, and record exact outcomes in `TEST_REPORT.json`.
5. Commit locally with an `auto-improve:` commit message and do not push.
6. If source files changed, build and restart `hermes-workspace.service`, then validate `/api/health` returns JSON `{"status":"ok"}`.

## How to verify the change works
- `git diff --check`
- `npx tsc --noEmit`
- `pnpm test`
- `pnpm lint` (record baseline failures separately if strict repo-wide lint still fails outside the change intent)
- `pnpm build`
- Parse `TEST_REPORT.json` and confirm `passed: true`
- External health check requires HTTP 200, `application/json`, and JSON body status `ok` after restart.

## Rollback procedure
Run `git revert <auto-improve-commit>` on the local feature branch and restart `hermes-workspace.service` after a successful `pnpm build` if the UI regression reaches the deployed workspace.
