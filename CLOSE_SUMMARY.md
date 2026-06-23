# Close Summary: running-agent visibility and mobile tap ergonomics

## What changed
- Added `activeAgentSummaries` to the agent-view store and reset it with the live connection state.
- Rendered running-agent chips directly above the chat composer; tapping any chip opens Agent View.
- Removed the duplicated compact running-agent count from `SisterPicker`.
- Increased mobile tap targets across composer controls, agent input, inspector/settings buttons, message action controls, TUI activity rows, and job repeat pills while preserving compact desktop sizing.
- Removed a stale `react-hooks/exhaustive-deps` inline disable in `chat-screen.tsx` so the focused fallback lint gate has zero errors.

## Test results
- TypeScript: `npx tsc --noEmit` passed.
- Tests: `pnpm test` passed, 111 files / 718 tests.
- Build: `pnpm build` passed.
- Repo lint: `pnpm lint` still fails with 198 known baseline errors and 37 warnings.
- Focused fallback lint: changed TS/TSX files passed with 0 errors and 20 documented baseline warnings after disabling only the known `@typescript-eslint/no-unnecessary-condition` baseline rule.

## Side effects / leftovers
- Existing untracked screenshot artifacts remain under `screenshots/` plus `scripts/screenshot-viewports.cjs`; this cycle did not stage them.
- Because source files changed, deployment requires rebuild/restart plus JSON health validation.

## New improvement ideas
1. Add a focused DOM test for the running-agent tray using mocked `useAgentViewStore` state.
2. Normalize screenshot scripts and PNG output into an ignored report directory.
3. Reconcile the long-lived `feature/chat-ui-improvements` branch with `main` so auto-improvement commits can merge cleanly instead of remaining local-only.
