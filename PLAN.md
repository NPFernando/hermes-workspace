# Plan: Normalize Mobile Navigation Search Params

**Cycle**: 2026-07-04-navigation-search
**Category**: ui
**Effort**: low
**Selected from**: IDEAS.json entry "Normalize mobile navigation search params"

## Summary

Several mobile and sidebar navigation entry points call TanStack Router with only a `to` target. On typed routes this creates avoidable TypeScript friction and can preserve stale search state when moving between top-level workspace screens. Normalize these navigation calls by passing an explicit empty `search` object and remove unnecessary string casts on static route links.

## Files to Modify

- `src/components/dashboard-overflow-panel.tsx`
- `src/components/mobile-hamburger-menu.tsx`
- `src/components/mobile-tab-bar.tsx`
- `src/hooks/use-swipe-navigation.ts`
- `src/routes/$.tsx`
- `src/routes/chat/$sessionKey.tsx`
- `src/routes/index.tsx`
- `src/screens/chat/components/chat-sidebar.tsx`
- `src/screens/tasks/tasks-screen.tsx`

## Steps

1. Update programmatic top-level navigation calls to include `search: {}` so stale query params are cleared and the typed router contract is explicit.
2. Replace unnecessary `as string` casts on static route links/redirects with typed literal route values.
3. Tighten callback/function names and URL-task clearing search typings where the router needs an explicit search callback type.
4. Preserve unrelated finance/package worktree changes unstaged; this cycle only commits the navigation/search typing files plus standard mission artifacts.

## How to Verify

1. Run `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`.
2. Run focused ESLint on the changed navigation files.
3. Run `pnpm test` and `pnpm lint`; document any repository-wide baseline failures separately from this focused change.
4. Run `pnpm build`, restart `hermes-workspace.service`, and validate `/api/health` returns JSON `{"status":"ok"}` because source files changed.

## Rollback

Revert the auto-improvement commit, rebuild/restart the workspace service if it had been deployed, and re-run the JSON health check.
