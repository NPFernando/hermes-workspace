# Close Summary: Reduce chat overlay clutter and null sentinels

## What changed
- Added route-aware hiding for update-center cards, release notes, the What's New modal, and the floating usage-meter pill on chat routes.
- Kept usage-meter context alerts available for individual chat sessions while preventing the global pill from overlapping chat controls.
- Improved the chat sister picker with deduplicated options, a real button trigger, ARIA menu attributes, upward-opening popover placement, and a compact active-agent count pill.
- Cleaned chat rendering by removing literal `null` placeholders and filtering assistant `null`/`undefined` sentinels from history text without hiding user-authored text.

## Files changed
- `src/components/update-center-notifier.tsx` and test
- `src/components/usage-meter/usage-meter-session.ts`, `usage-meter.tsx`, and test
- `src/components/whats-new-modal.tsx` and test
- `src/hooks/use-agent-view.ts`
- `src/screens/chat/components/chat-composer.tsx`
- `src/screens/chat/components/chat-header.tsx`
- `src/screens/chat/components/chat-message-list.tsx`
- `src/screens/chat/components/sister-picker.tsx`
- `src/screens/chat/utils.ts` and test
- `src/styles.css`

## Test results
- TypeScript: `npx tsc --noEmit` passed under Node 22.
- Focused Vitest: 4 files / 14 tests passed.
- Focused ESLint JSON: 0 errors, 15 warnings (ignored test-file warnings plus existing chat-composer no-shadow warnings).
- Production build and service health were verified during deployment.

## Side effects observed
- System Node v18 cannot run the current Vitest/ESLint stack because dependencies expect newer Web APIs; `/home/ubuntu/.hermes/node/bin` Node v22 works.
- Several stale untracked backup/scratch files remain in the worktree and should be cleaned in a separate safe cleanup cycle.

## New improvement ideas for next cycle
1. Clean stale untracked backup and scratch files in `/home/ubuntu/hermes-workspace` after classifying each file.
2. Add a repo-local Node version guard or `.nvmrc`/tooling note so cron verification always uses Node 22+.
3. Convert ignored test-file lint warnings into a quieter lint command or config so focused reports are easier to read.
