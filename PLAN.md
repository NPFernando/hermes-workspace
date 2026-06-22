# Plan: Polish mobile and responsive workspace surfaces

## Summary of the change
Complete a low-risk UI polish pass over the existing dirty responsive worktree. The change improves touch ergonomics, safe-area handling, responsive empty states, markdown readability, tab overflow affordance, and non-chat page bottom clearance without changing API behavior.

## Files to modify
- `src/components/chat-panel.tsx`
- `src/components/mobile-page-header.tsx`
- `src/components/mobile-tab-bar.tsx`
- `src/components/prompt-kit/markdown.tsx`
- `src/screens/chat/components/chat-empty-state.tsx`
- `src/screens/dashboard/dashboard-screen.tsx`
- `src/screens/vt-capital/vt-capital-screen.tsx`
- `src/styles.css`

## Steps
1. Treat the existing coherent responsive UI diff on `feature/chat-ui-improvements` as the implementation candidate.
2. Keep changes limited to `src/` files; do not stage local screenshot artifacts.
3. Verify the diff for whitespace errors with `git diff --check`.
4. Verify TypeScript with Hermes-managed Node 22 using `npx tsc --noEmit`.
5. Run focused tests for responsive shell/chat surfaces where available, then full `pnpm test`.
6. Run focused ESLint on changed source files; record repository-wide lint separately if baseline debt remains.
7. Commit the source changes with `auto-improve: polish responsive workspace touch surfaces` on the current branch. Do not push.

## How to verify the change works
- `git diff --check` exits 0.
- `npx tsc --noEmit` exits 0.
- `pnpm test` exits 0.
- Focused lint on changed source files exits 0 or only reports accepted baseline issues documented in `TEST_REPORT.json`.
- `TEST_REPORT.json` contains `passed: true`.
