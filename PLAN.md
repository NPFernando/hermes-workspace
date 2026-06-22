# Plan: Make hover-only controls discoverable on touch devices

## Summary of the change
Complete the existing coherent dirty worktree on `feature/chat-ui-improvements` as a mobile/touch usability pass. The selected change makes controls that were previously hidden behind hover visible or partially visible on coarse-pointer devices, increases small touch targets where needed, and adds global mobile CSS guardrails for native selects, input zoom, and nested scroll containment.

## Files to modify
- `src/components/agent-view/agent-card.tsx`
- `src/components/agent-view/agent-view-panel.tsx`
- `src/components/apply-mode-dialog.tsx`
- `src/components/inspector/inspector-panel.tsx`
- `src/components/keyboard-shortcuts-modal.tsx`
- `src/components/manage-modes-modal.tsx`
- `src/components/mobile-prompt/MobilePromptTrigger.tsx`
- `src/components/mobile-prompt/MobileSetupModal.tsx`
- `src/components/mobile-sessions-panel.tsx`
- `src/components/model-suggestion-toast.tsx`
- `src/components/orchestrator-avatar.tsx`
- `src/components/prompt-kit/*.tsx`
- `src/components/*mode-dialog.tsx`
- `src/components/swarm/router-chat.tsx`
- `src/components/update-center-notifier.tsx`
- `src/components/usage-meter/usage-details-modal.tsx`
- `src/components/whats-new-modal.tsx`
- `src/routes/files.tsx`
- `src/routes/settings/index.tsx`
- `src/screens/**`
- `src/styles.css`

## Steps
1. Treat the current pre-existing dirty `src/` diff as the implementation candidate; it consistently replaces mouse-hover-only visibility with coarse-pointer fallbacks and mobile-safe sizing.
2. Do not stage generated screenshot files under `screenshots/` or ad-hoc screenshot scripts unless a future cycle explicitly turns them into supported tooling.
3. Verify the diff has no whitespace errors with `git diff --check`.
4. Verify TypeScript under the Hermes-managed Node 22 runtime using `npx tsc --noEmit`.
5. Run focused Vitest coverage for responsive shell/chat surfaces, then full `pnpm test`.
6. Run focused ESLint over changed TypeScript/React source files and separately record the repository-wide lint baseline if it still fails.
7. Write `TEST_REPORT.json`, commit the intended source/artifact updates locally with `auto-improve: expose hover controls on touch devices`, and do not push.

## How to verify the change works
- `IDEAS.json` is valid JSON with at least three ideas.
- `PLAN.md` contains `Files to modify` and `Steps` sections.
- `git diff --check` exits 0.
- `npx tsc --noEmit` exits 0.
- Focused responsive/chat tests and full `pnpm test` pass.
- Focused ESLint on changed TypeScript/React source files has 0 errors.
- `TEST_REPORT.json` contains `passed: true`.
