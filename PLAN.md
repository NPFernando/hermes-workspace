# Plan: Add guarded Finance workspace

## Summary of the change
Add a Finance section to `~/hermes-workspace` that gives Naveen a safe foundation for personal finance tracking, tax estimates, investment monitoring, and future Binance/IBKR workflows. The implementation keeps live trading disabled by default, stores data in a private local JSON store under `~/.hermes/finance`, masks sensitive keys/tokens in API payloads, and requires an explicit approval phrase before live trading modes can be selected.

## Files to modify
- `src/routes/finance.tsx`
- `src/routes/api/finance.ts`
- `src/screens/finance/finance-screen.tsx`
- `src/server/finance-store.ts`
- `src/server/finance-store.test.ts`
- `src/server/finance-schema.sql`
- `src/components/mobile-hamburger-menu.tsx`
- `src/components/mobile-tab-bar.tsx`
- `src/components/workspace-shell.tsx`
- `src/screens/chat/components/chat-sidebar.tsx`
- `src/routeTree.gen.ts`

## Steps
1. Add a server-side finance store with typed records for accounts, income, expenses, budgets, savings goals, tax records, assets, market prices, news, risk scores, and trading plans.
2. Persist the finance database and append-only audit log under `~/.hermes/finance` with restrictive file modes.
3. Add authenticated `/api/finance` GET/POST handlers for payload retrieval, adding records, changing trading mode, and emergency stop.
4. Enforce trading safety guardrails: withdrawals/leverage/futures disabled, live trading off by default, emergency kill switch active, and executable plans blocked unless stop-loss/exit/position controls exist.
5. Add a `/finance` route and Finance screen showing summary cards, alerts, rollout coverage, data tables, storage/security notes, and connector guardrails.
6. Wire Finance into desktop sidebar, mobile hamburger menu, mobile tab bar, route tree, and workspace shell page title.
7. Add focused Vitest coverage for summary calculations, blocked trading plans, masking, and alerts.
8. Validate with TypeScript, focused tests, full tests/lint where possible, build, diff checks, and JSON health after restart.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH`
- `npx tsc --noEmit`
- `npx vitest run src/server/finance-store.test.ts`
- `pnpm test` and record any repository baseline collection failures separately from changed-file regressions.
- `pnpm lint` and run focused changed-file ESLint if repository-wide lint has known baseline debt.
- `pnpm build`
- `git diff --check`
- Restart `hermes-workspace.service` only because source files changed, then validate `https://agent.fernandofamily.com/api/health` returns HTTP 200, JSON content type, and `{ "status": "ok" }`.

## Rollback procedure
Revert the auto-improve commit. If desired, archive or remove `~/.hermes/finance/finance.json` and `~/.hermes/finance/audit.jsonl`; those runtime data files are outside the repository and are not required for rollback.
