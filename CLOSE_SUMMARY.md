# Close Summary: Task stat filter accessibility

## What changed
- `src/screens/tasks/tasks-screen.tsx`: converted the Tasks header blocked-count control from a clickable `<span>` into a semantic `<button type="button">` with `aria-pressed`, an explicit accessible label, and keyboard-visible focus styling.
- `src/screens/tasks/tasks-screen.tsx`: added an accessible label and focus ring to the timed-out analysis button.
- `src/screens/tasks/tasks-screen.tsx`: added `formatTaskStatFilterButtonLabel()` for reusable, tested header-stat filter copy.
- `src/screens/tasks/tasks-ux.test.ts`: added focused coverage for the new stat filter button label helper.
- `IDEAS.json`, `PLAN.md`, and `TEST_REPORT.json`: updated the current auto-improvement artifacts while preserving the existing idea backlog.

## Test results
- `npx tsc --noEmit`: passed.
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`: passed, 10 tests.
- `pnpm test`: passed, 110 files / 724 tests.
- Focused relaxed ESLint for touched Tasks files: 0 errors, 0 warnings.
- `git diff --check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: still fails on repository-wide baseline debt outside touched files (240 errors, 105 warnings), so it was recorded as baseline rather than a changed-file regression.
- `pnpm -s lint:class-tokens`: script is absent in this checkout; fallback scan over touched TS/TSX files found no known joined class-token patterns.

## Deployment
`main` was fast-forwarded locally to the auto-improvement commit without pushing. Because `src/` changed, the workspace was rebuilt, `hermes-workspace.service` was restarted, and health was validated. The first external health request hit the known transient nginx 502 warmup, then the second attempt returned HTTP 200 `application/json` with `{ "status": "ok" }`; systemd reported the service as `active`.

## Side effects and follow-up ideas
Unrelated pre-existing worktree entries remain unstaged (`services/odysseus` gitlink plus untracked finance/memory documentation drafts). Follow-up ideas appended or preserved include adding Tasks stat button focus smoke coverage, exposing task-board refresh timing copy, and reducing repository-wide lint baseline debt so full lint can become a hard gate again.
