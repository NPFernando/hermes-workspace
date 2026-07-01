# Close Summary — Reduce Tasks screen focused ESLint shadowing debt

## What changed
- Cleaned two `no-shadow` findings in `src/screens/tasks/tasks-screen.tsx` without changing behavior:
  - Renamed the grouped todo row column alias from `columnMap` to `taskColumnsByStatus`.
  - Renamed the activity notification click-handler local from `t` to `selectedTask`.
- Preserved and appended new follow-up ideas in `IDEAS.json`.
- Wrote this cycle's plan and test report in `PLAN.md` and `TEST_REPORT.json`.

## Test results
- `npx tsc --noEmit`: passed.
- Focused relaxed Tasks lint (`npx eslint --no-warn-ignored -f json --rule '@typescript-eslint/no-unnecessary-condition: off' src/screens/tasks/tasks-screen.tsx`): passed with 0 errors and 0 warnings.
- `git diff --check`: passed.
- Class-token fallback scan on changed TS/TSX/CSS files: passed with no findings. The package script `pnpm -s lint:class-tokens` is not present in this checkout and returned command-not-found.
- `pnpm test`: passed.
- `pnpm lint`: failed on existing repository-wide strict-lint baseline debt outside this focused cleanup; the touched file's focused gate is clean under the documented baseline-rule override.
- `pnpm build`: passed.

## Deployment result
Deployment succeeded. `pnpm build` passed, `sudo systemctl restart hermes-workspace.service` completed, `systemctl is-active hermes-workspace.service` returned `active`, and `/api/health` returned HTTP 200 with `application/json` body `{"status":"ok"}`.

## Side effects / blockers
- The requested `hermes dispatch-mission` command is not available in this Hermes CLI build, so this run used the documented manual fallback.
- Pre-existing dirty/untracked files were left unstaged: `scripts/upstream-sync.py`, `services/odysseus`, and finance/memory draft docs.
- During final validation the worktree also showed unrelated unstaged source edits (`src/components/prompt-kit/mermaid-block.tsx`, `src/routes/api/events.ts`, `src/routes/api/files.ts`, `src/routes/api/tasks-exec-log.ts`, `src/screens/chat/components/chat-composer.tsx`, `src/screens/tasks/task-card.tsx`, `src/server/astra-tasks.ts`, `src/server/telegram-clarify.ts`). These were not staged or included in this auto-improvement commit.

## New improvement ideas
- Reduce the remaining `@typescript-eslint/no-unnecessary-condition` findings in `src/screens/tasks/tasks-screen.tsx` so the focused lint gate can run strict.
- Add a checked-in class-token smoke script/package entry for this checkout, or remove stale references to `lint:class-tokens` where unsupported.
- Extract grouped-row and activity-notification helper logic from `tasks-screen.tsx` into small tested utilities.
