# Plan: Surface running agents and improve mobile tap ergonomics

## Summary of the change
Surface active agent runs in a composer-adjacent tray, make it easy to open Agent View from mobile, and enlarge small secondary controls so touch users get reliable tap targets without losing compact desktop density.

## Files to modify
- `src/hooks/use-agent-view.ts`
- `src/screens/chat/chat-screen.tsx`
- `src/screens/chat/components/sister-picker.tsx`
- `src/screens/chat/components/chat-composer.tsx`
- `src/components/agent-chat/AgentChatInput.tsx`
- `src/components/agent-view/agent-view-panel.tsx`
- `src/components/inspector/inspector-panel.tsx`
- `src/components/settings-dialog/settings-dialog.tsx`
- `src/screens/chat/components/chat-message-list.tsx`
- `src/screens/chat/components/message-item.tsx`
- `src/screens/chat/components/tui-activity-card.tsx`
- `src/screens/jobs/edit-job-dialog.tsx`

## Steps
1. Extend the agent-view store with lightweight active-agent summaries derived from the live agent list.
2. Render those summaries above the chat composer as horizontal, touch-friendly status chips that open Agent View.
3. Remove the cramped running-agent count from the sister picker to avoid duplicate status surfaces.
4. Increase mobile tap target height/padding for secondary controls while keeping compact `sm:`/`md:` desktop sizing.
5. Fix stale inline lint suppression in the touched chat screen section so focused relaxed lint has no errors.

## How to verify the change works
- `git diff --check`
- `npx tsc --noEmit`
- `pnpm test`
- `pnpm lint` for baseline documentation, then focused changed-file ESLint with the known baseline `@typescript-eslint/no-unnecessary-condition` rule disabled.
- `pnpm build`
- Restart `hermes-workspace.service` and validate `/api/health` returns JSON `{"status":"ok"}` because source files changed.

## Rollback procedure
Revert the local commit `auto-improve: surface running agents and mobile tap ergonomics`, rebuild, restart `hermes-workspace.service`, and re-run the JSON health check.
