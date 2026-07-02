# Plan: Quarantine scratch root test files from default Vitest

## Summary of the change
The default `pnpm test` command currently discovers an ad-hoc root-level `testCurrencyConversion.test.ts` scratch script. The file prints useful manual finance diagnostics but does not define a Vitest suite, so Vitest reports "No test suite found" and exits non-zero even while all real tests pass. This cycle will quarantine the known root scratch files from default Vitest discovery without touching the scratch files or unrelated dirty worktree changes.

## Files to modify
- `vite.config.ts` — add explicit Vitest excludes for root-level scratch currency-conversion scripts.
- `IDEAS.json` — append/de-duplicate current and follow-up improvement ideas.
- `PLAN.md` — this implementation plan.
- `TEST_REPORT.json` — captured verification output.
- `CLOSE_SUMMARY.md` — close/reflection artifact after verification and deployment.

## Steps
1. Update the `test.exclude` list in `vite.config.ts` with root-only excludes for `/testCurrencyConversion.test.ts`, `/testCurrencyConversion.ts`, and `/testCurrencyConversion.js`.
2. Run TypeScript compilation with Node 22: `pnpm -s exec tsc --noEmit --pretty false`.
3. Run `pnpm test` to verify the scratch file is no longer collected and all real suites pass.
4. Run `pnpm lint`; if repository-wide lint fails on pre-existing dirty files, record the exact result and run focused lint on `vite.config.ts`.
5. Run `pnpm build` because `vite.config.ts` affects build/test tooling.
6. Restart `hermes-workspace.service` and validate both systemd state and JSON health body.
7. Stage only the intended cycle files and commit locally with `auto-improve: quarantine scratch vitest files`. Do not push.

## How to verify the change works
- `pnpm test` exits 0 and no longer reports `No test suite found in file /home/ubuntu/hermes-workspace/testCurrencyConversion.test.ts`.
- `pnpm -s exec tsc --noEmit --pretty false` exits 0.
- `pnpm -s exec eslint vite.config.ts` exits 0.
- `pnpm build` exits 0.
- `systemctl is-active hermes-workspace.service` returns `active` and `https://agent.fernandofamily.com/api/health` returns JSON with `{"status":"ok"}`.

## Rollback procedure
Revert the local commit or remove the three added root scratch-file exclude entries from `vite.config.ts`, then rerun `pnpm test` to confirm the old collection behavior returns if needed.
