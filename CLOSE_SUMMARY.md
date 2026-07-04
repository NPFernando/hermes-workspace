# Close Summary: Normalize Mobile Navigation Search Params

## What changed

This auto-improvement cycle normalized several top-level mobile/sidebar navigation paths so TanStack Router receives explicit empty search params when moving between workspace screens. That keeps stale query params from leaking across screen changes and removes avoidable type friction in static route links and redirects.

Changed runtime files:
- `src/components/dashboard-overflow-panel.tsx`
- `src/components/mobile-hamburger-menu.tsx`
- `src/components/mobile-tab-bar.tsx`
- `src/hooks/use-swipe-navigation.ts`
- `src/routes/$.tsx`
- `src/routes/chat/$sessionKey.tsx`
- `src/routes/index.tsx`
- `src/screens/chat/components/chat-sidebar.tsx`
- `src/screens/tasks/tasks-screen.tsx`

Mission artifacts updated:
- `IDEAS.json` appended three de-duplicated follow-up ideas.
- `PLAN.md` records the selected navigation/search-param plan.
- `TEST_REPORT.json` records verification, lint baseline debt, deployment, and health results.

## Test results

- `npx tsc --noEmit`: passed before commit and after close-artifact amend.
- Focused ESLint on changed files: strict run exposed known baseline debt; relaxed focused gate passed with 0 errors and 1 pre-existing `require-await` warning.
- `pnpm test`: passed, 120 test files / 798 tests.
- `pnpm lint`: still fails repo-wide with 547 errors and 104 warnings from existing baseline debt and unrelated dirty/untracked finance drafts; no focused regression was found in this cycle.
- `pnpm build`: passed.

## Deployment and health

Because source files changed, the workspace was rebuilt and `hermes-workspace.service` was restarted. `systemctl is-active hermes-workspace.service` reported `active`. The first external health request returned a transient nginx 502 while Node warmed up, then the bounded retry succeeded with HTTP 200, `application/json`, and body `{"status":"ok"}`.

## Side effects / worktree boundary

The cycle intentionally left unrelated pre-existing dirty work unstaged: `package.json`, `pnpm-lock.yaml`, `services/odysseus`, `src/routes/api/finance.ts`, `dist.old-20260704_035903/`, and untracked finance/performance server drafts. Those files were not part of this improvement commit.

## New ideas added for future cycles

1. Archive stale `dist.old-*` build backups outside the repo or ignore them explicitly.
2. Extract shared typed navigation helpers and add coverage for clearing stale search params.
3. Continue reducing repo-wide ESLint baseline debt so focused gates need fewer rule overrides.
