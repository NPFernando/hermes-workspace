# Fix chat history loading TODO

## Summary
Re-enable and improve the chat history loading logic in `use-realtime-chat-history.ts` by implementing smarter timing for clearing the realtime buffer. The current code has a TODO to re-enable the cleanup of the realtime buffer with smarter timing (only after history confirms the message). This change modifies the cleanup effect to wait for stream to end, then wait 2 seconds, and ensure the last realtime message is not a streaming message.

## Files to modify
- `src/screens/chat/hooks/use-realtime-chat-history.ts`

## Step-by-step implementation
1. Open `src/screens/chat/hooks/use-realtime-chat-history.ts`.
2. Locate the `useEffect` block that clears the realtime buffer (lines 547-562 in the current version).
3. Replace the current condition with a more sophisticated check that ensures the message has been persisted to history before clearing the buffer.
4. Implement the check by verifying that the last message in the realtime buffer (if any) is present in the history messages (mergedMessages) by comparing a unique identifier (e.g., timestamp + content hash) or by checking that the realtime buffer is empty or only contains messages that have been acknowledged by history.
5. For simplicity and safety, we will implement a hybrid approach: keep the existing timeout but add a condition that the last realtime message is not a streaming message (i.e., does not have `__streamingStatus === 'streaming'`) and that at least 2 seconds have passed since the stream ended.
6. After making the change, save the file.
7. Run `cd /home/ubuntu/hermes-workspace && npx tsc --noEmit` to verify TypeScript compiles without errors.
8. If there are any errors, adjust the implementation accordingly.

## How to verify the change works
- TypeScript compilation succeeds (`tsc --noEmit` exits with code 0).
- Manual verification: 
  - Open the workspace UI in a browser.
  - Send a message and observe that the message appears and stays (does not disappear after a brief flash).
  - Send multiple messages in quick succession and ensure they all remain visible.
  - Check that the realtime buffer is cleared appropriately (no memory leak).
- Since we cannot run the full test suite in this environment, we rely on the TypeScript check and manual inspection.

## Rollback procedure
- If the change causes issues, revert the file to its previous state using Git:
  ```bash
  cd /home/ubuntu/hermes-workspace
  git checkout HEAD -- src/screens/chat/hooks/use-realtime-chat-history.ts
  ```