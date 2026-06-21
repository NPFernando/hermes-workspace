# PLAN — Polish responsive workspace shell behavior

## Summary of the change
Use the current coherent responsive UI worktree as this cycle's implementation: improve tablet sidebar behavior, PWA/standalone safe-area handling, landscape-mobile breathing room, and narrow chat/code rendering.

## Files to modify
- `src/components/workspace-shell.tsx`
- `src/components/prompt-kit/chat-container.tsx`
- `src/routes/__root.tsx`
- `src/styles.css`

## Steps
1. Treat the existing dirty worktree changes in the four source files above as the implementation candidate.
2. Verify that tablet widths auto-collapse the sidebar to an icon rail and that mobile session selection still collapses only on mobile.
3. Verify standalone display-mode changes update safe-area CSS variables reactively.
4. Verify chat content exposes an inline-size container so code blocks can shrink at narrow widths.
5. Keep screenshot helper files uncommitted as local visual QA artifacts unless they are intentionally promoted in a future cycle.
6. Run TypeScript and focused/full tests before committing.
7. Commit only the four source files on the current feature branch with an `auto-improve:` message. Do not push.

## How to verify the change works
- `git diff --check`
- `npx tsc --noEmit`
- `npx vitest run src/routes/-files-responsive.test.ts src/components/workspace-shell.test.ts src/components/slash-command-menu.test.tsx`
- `pnpm test`
- `pnpm lint` (record existing baseline separately if it fails outside this change)
- `pnpm build` before any service restart
- External health check must return HTTP 200, `application/json`, and `{"status":"ok"}` after restart.

## Rollback procedure
Revert the auto-improvement commit on `feature/chat-ui-improvements` or restore the four listed source files from `HEAD~1`, rebuild, restart `hermes-workspace.service`, and rerun the JSON health check.
