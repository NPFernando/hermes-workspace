# Close Summary — Add sidebar session skeleton loading states

## What was changed

- **`src/screens/chat/components/sidebar/sidebar-sessions.tsx`** — Added a `SessionItemSkeleton` component that renders 3 compact skeleton rows (title line + subtitle line using `animate-pulse`), matching the `SessionItem` layout. Replaced the plain "Loading sessions…" text with the skeleton placeholder. Added `shouldShowSessionSkeleton()` helper that shows skeletons during initial load or during background fetch with no data yet. Used `role="status"` and `aria-busy="true"` for screen-reader support.

- **`src/screens/chat/components/sidebar/sidebar-sessions.test.ts`** — Focused unit tests for `shouldShowSessionSkeleton` covering all 7 loading/fetching/data combinations.

## Test results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (Node 22) | ✅ 0 errors in changed files |
| Focused helper tests (7 tests) | ✅ All passed |
| Focused ESLint on changed files | ✅ 0 errors, 0 warnings |
| `git diff --check` on changed files | ✅ Clean |
| `pnpm build` | ✅ Built in 15.32s |
| Service restart | ✅ `hermes-workspace.service` active |
| Health check | ✅ `{"status":"ok"}` |

## Deployment

- Branch: `feat/task-blocker-system` (3 behind main, 40 ahead — merge blocked, deployed from current branch)
- Source files changed → built, restarted service, validated JSON health body
- No push to remote

## Side-effects observed

- Existing "Updating…" indicator during background fetch with existing data is preserved unchanged
- Skeleton uses the workspace's standard `animate-pulse` with `bg-[var(--theme-hover)]` — consistent with other loading patterns in the codebase
- The `shouldShowSessionSkeleton` logic is a pure exported function, testable without rendering
- All unrelated dirty worktree files (finance/trading/dashboard work) left unstaged
