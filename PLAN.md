# Plan: Reduce chat overlay clutter and null sentinels

## Summary of the change
Polish the Hermes workspace chat experience by keeping global update/usage overlays off chat routes, making the agent picker more compact and accessible, surfacing active agent count, and hiding serialized empty assistant payloads from chat history.

## Files to modify
- `src/components/update-center-notifier.tsx`
- `src/components/update-center-notifier.test.tsx`
- `src/components/usage-meter/usage-meter-session.ts`
- `src/components/usage-meter/usage-meter-session.test.ts`
- `src/components/usage-meter/usage-meter.tsx`
- `src/components/whats-new-modal.tsx`
- `src/components/whats-new-modal.test.tsx`
- `src/hooks/use-agent-view.ts`
- `src/screens/chat/components/chat-composer.tsx`
- `src/screens/chat/components/chat-header.tsx`
- `src/screens/chat/components/chat-message-list.tsx`
- `src/screens/chat/components/sister-picker.tsx`
- `src/screens/chat/utils.ts`
- `src/screens/chat/utils.test.ts`
- `src/styles.css`

## Steps
1. Add route-aware helpers to suppress global update cards, release notes, the whats-new modal, and the floating usage-meter pill on `/chat` routes.
2. Keep usage-meter context alerts available for chat sessions while hiding only the global floating pill.
3. Export the active agent count through the agent-view store and render a compact active-agent pill in the chat sister picker.
4. Deduplicate sister options, convert the selector trigger to a real button, add menu accessibility attributes, and make the popover open upward from the composer area.
5. Replace accidental literal `null` placeholders in the chat message list and filter assistant `null`/`undefined` sentinels in `textFromMessage` without touching user text.
6. Add focused regression tests for overlay routing, usage-meter visibility, whats-new route gating, and assistant sentinel filtering.
7. Verify with Node 22, `npx tsc --noEmit`, focused Vitest, focused ESLint JSON output, and a production build before restarting the service.

## How to verify the change works
- `PATH=/home/ubuntu/.hermes/node/bin:$PATH npx tsc --noEmit` exits 0.
- `PATH=/home/ubuntu/.hermes/node/bin:$PATH npx vitest run src/components/update-center-notifier.test.tsx src/components/usage-meter/usage-meter-session.test.ts src/components/whats-new-modal.test.tsx src/screens/chat/utils.test.ts` passes.
- `PATH=/home/ubuntu/.hermes/node/bin:$PATH npx eslint -f json <modified files>` reports 0 errors.
- `PATH=/home/ubuntu/.hermes/node/bin:$PATH npm run build` exits 0.
- `https://agent.fernandofamily.com/api/health` returns HTTP 200, JSON content type, and `{"status":"ok"}` after deployment.

## Rollback procedure
Revert the generated `auto-improve: reduce chat overlay clutter` commit, rebuild, and restart `hermes-workspace.service` if the change has already been deployed.
