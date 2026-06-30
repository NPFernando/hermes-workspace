# Plan: Fix Vitest collection baseline for E2E and TAP suites

## Summary of the change
Default `pnpm test` should report Vitest unit-test failures, not collection failures from suites that require other runners. The current Vitest config excludes dependency/build folders but still lets Playwright `e2e/*.spec.ts` and Odysseus TAP `.mjs` suites enter the unit-test run. Add explicit excludes for those paths.

## Files to modify
- `vite.config.ts`
- `IDEAS.json`
- `PLAN.md`
- `TEST_REPORT.json`
- `CLOSE_SUMMARY.md`

## Steps
1. Preserve and de-duplicate the existing `IDEAS.json` backlog while adding this config-hygiene idea and follow-ups.
2. Update the `test.exclude` list in `vite.config.ts` to exclude `e2e/**` and `services/odysseus/tests/**/*.mjs` from Vitest.
3. Run TypeScript compile, focused Vitest collection/affected tests, full `pnpm test`, lint, build, and whitespace checks.
4. Commit only the intended config/artifact files, leaving pre-existing dirty source files and gitlinks unstaged.
5. Restart the workspace service because the mission treats source/config changes as deployment-triggering, then validate systemd state and JSON health body shape.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx vitest run --list`
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && pnpm test`
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && pnpm lint`
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && pnpm build`
- `git diff --check`
- JSON health validation requires HTTP 200, `application/json`, and `{"status":"ok"}`.

## Rollback procedure
Revert the `test.exclude` additions in `vite.config.ts`, restore the prior artifacts from git, rebuild, restart `hermes-workspace.service`, and re-run the JSON health check.
