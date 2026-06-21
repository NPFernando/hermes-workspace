# Plan: Polish responsive workspace surfaces

## Summary of the change
Improve the Hermes workspace's responsive behavior across the high-density UI screens that cron found already modified in the active worktree. The change keeps desktop layouts intact while making mobile/narrow screens easier to navigate: the Files route gets a tree-to-editor mobile flow, shell/sidebar/footer sizing is softened, Tasks and Swarm surfaces gain responsive wrapping/spacing, and focused regression coverage is added for the Files responsive contract.

## Files to modify
- `src/components/file-explorer/file-explorer-sidebar.tsx`
- `src/components/prompt-kit/prompt-input.tsx`
- `src/components/slash-command-menu.test.tsx`
- `src/components/system-metrics-footer.tsx`
- `src/components/workspace-shell.test.ts`
- `src/components/workspace-shell.tsx`
- `src/routes/__root.tsx`
- `src/routes/files.tsx`
- `src/routes/-files-responsive.test.ts`
- `src/screens/agents/components/operations-agent-detail.tsx`
- `src/screens/agents/components/operations-new-agent-modal.tsx`
- `src/screens/agents/components/operations-settings-modal.tsx`
- `src/screens/agents/components/orchestrator-card.tsx`
- `src/screens/chat/chat-screen.tsx`
- `src/screens/chat/components/chat-composer.tsx`
- `src/screens/chat/components/chat-sidebar.tsx`
- `src/screens/crew/crew-screen.tsx`
- `src/screens/dashboard/dashboard-screen.tsx`
- `src/screens/swarm2/swarm2-screen.tsx`
- `src/screens/tasks/tasks-screen.tsx`
- `src/styles.css`
- `vite.config.ts`

## Steps
1. Preserve the active responsive UI changes already present on `feature/chat-ui-improvements` instead of discarding them as stale cron state.
2. Tighten the Files route mobile flow so mobile users can choose from the file tree, collapse into the editor, and reopen/close the tree with explicit controls.
3. Keep workspace chrome, footer metrics, agents modals/cards, Tasks, Swarm, Chat, Crew, and Dashboard layouts from forcing desktop widths on smaller screens.
4. Add focused Files responsive assertions in `src/routes/-files-responsive.test.ts`.
5. Keep Vitest focused on the test suites it owns by excluding `services/**` and `e2e/**` from Vitest discovery.
6. Fix the new `Array<string>` lint style issue in `src/routes/__root.tsx` introduced by the service worker cache guard.
7. Verify with TypeScript, the full Vitest suite, diff whitespace checks, focused lint accounting, build, and JSON health endpoint validation.

## How to verify the change works
- `PATH=/home/ubuntu/.hermes/node/bin:$PATH npx tsc --noEmit` exits 0.
- `PATH=/home/ubuntu/.hermes/node/bin:$PATH pnpm test` exits 0.
- `git diff --check` exits 0.
- `PATH=/home/ubuntu/.hermes/node/bin:$PATH pnpm build` exits 0.
- Health check returns HTTP 200, `application/json`, and body `{"status":"ok"}` after restart.

## Rollback procedure
Revert the generated `auto-improve: polish responsive workspace surfaces` commit on `feature/chat-ui-improvements`. If the current branch cannot be merged into `main` because of branch divergence, leave the revert on the feature branch and deploy from the previous known-good worktree until the branch is reconciled with `main`.
