# Close Summary: Keep Tasks Header Stats Readable

## What changed

- Added `TASK_STATS_ROW_CLASS` in `src/screens/tasks/format-utils.ts` as a single source of truth for compact Tasks header stat-row layout.
- Updated `src/screens/tasks/tasks-screen.tsx` to use that class so each stat phrase stays intact with `whitespace-nowrap` while the row can wrap instead of forcing horizontal scroll.
- Added focused coverage in `src/screens/tasks/tasks-ux.test.ts` to prevent reintroducing horizontal stat-row scrolling.
- Appended follow-up improvement ideas to `IDEAS.json`; preserved existing backlog entries.

## Test results

- `npx tsc --noEmit`: passed.
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`: passed, 12 tests.
- Focused relaxed ESLint on changed Tasks files: passed, 0 errors / 0 warnings.
- `pnpm test`: passed, 111 files / 728 tests.
- `pnpm lint`: failed on repository baseline debt, 255 errors / 105 warnings, including unrelated server/finance files and untracked `src/server/performance.ts`; changed-file focused lint passed.
- `pnpm lint:class-tokens`: unavailable because the package script is undefined; fallback class-token scan over changed Tasks files passed.
- `pnpm build`: passed.

## Deployment

- Restarted `hermes-workspace.service`; `systemctl is-active hermes-workspace.service` returned `active`.
- External health validation used status, content type, and JSON body checks. The first request returned a transient nginx 502 during warmup; bounded retry succeeded with `200 application/json` and body `'{"status":"ok"}'`.

## Side effects / notes

- `hermes dispatch-mission` is still not available in Hermes CLI, so this cron cycle used the skill's manual fallback path.
- Left unrelated pre-existing dirty worktree items unstaged: finance route/test changes, Odysseus gitlink, untracked finance/trading/docs drafts, and scratch reports.
- No remote push or PR was created.

## New improvement ideas

1. Add mobile visual-smoke coverage for populated Tasks header stats.
2. Add a real `lint:class-tokens` package script or document the fallback scanner.
3. Reduce repository-wide ESLint baseline debt so small UI cycles can rely on strict full lint.
