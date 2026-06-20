# Plan: Repair mobile chat TypeScript regressions

## Summary of the change
Restore the Hermes workspace chat UI to a compiling state after recent mobile-focused edits left malformed JSX, invalid navigation calls, missing imports, and stale activity-summary behavior.

## Files to modify
- `src/hooks/use-keyboard-shortcuts.ts`
- `src/routes/api/chat-events.ts`
- `src/routes/settings/index.tsx`
- `src/screens/chat/components/chat-composer.tsx`
- `src/screens/chat/components/chat-header.tsx`
- `src/screens/chat/components/chat-message-list.tsx`
- `src/screens/chat/components/message-item.tsx`
- `src/screens/chat/components/sister-picker.tsx`
- `src/lib/theme.ts`
- Existing in-progress mobile UI files already modified on the current branch

## Steps
1. Fix malformed JSX/TSX syntax in chat composer, chat header, chat message list, and message item.
2. Add/repair imports for authenticated chat-events SSE and workspace directive title parsing.
3. Update keyboard shortcut navigation to the current TanStack Router object form.
4. Add the missing Odysseus Light settings preview entry to match the theme registry.
5. Convert the sister picker popover trigger to use a DOM ref plus explicit keyboard handler.
6. Repair trailing tool-only turn summary logic so it returns `null` when the thread already ends with assistant text.
7. Verify with `npx tsc --noEmit`, focused ESLint on modified files, and focused Vitest coverage for chat rendering/workspace directive behavior.

## How to verify the change works
- `npx tsc --noEmit` exits 0.
- `npx eslint <modified-files>` exits 0, allowing existing warnings only.
- `npx vitest run src/screens/chat/components/chat-message-list.test.tsx src/screens/chat/components/message-item.streaming-activity.test.tsx src/lib/workspace-message-scope.test.ts src/screens/chat/utils.test.ts` passes.
- Full `npm test` was attempted; remaining failures are unrelated existing environment/baseline issues recorded in `TEST_REPORT.json`.

## Rollback procedure
Revert the generated `auto-improve: repair mobile chat regressions` commit or restore the touched files from the previous branch state with `git checkout HEAD~1 -- <file>`.
