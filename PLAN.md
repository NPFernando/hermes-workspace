# Plan: Ignore and purge local auto-improvement scratch artifacts

## Summary of the change
Keep future cron-driven improvement cycles from tripping over stale local scratch files by adding focused ignore rules for known auto-improvement artifacts and removing the currently stale untracked copies from the worktree.

## Files to modify
- `.gitignore`
- Worktree-only cleanup of untracked scratch artifacts:
  - `MOBILE_FIX_SUMMARY.md`
  - `REVIEW_APPROVED`
  - `fix_async.py`
  - `fix_async2.py`
  - `src/lib/utils.ts.bak`
  - `src/screens/chat/chat-header.tsx`
  - `src/screens/chat/components/chat-header.tsx.bak`
  - `src/screens/chat/components/chat-message-list.tsx.bak`
  - `src/screens/chat/components/sister-picker.tsx.backup`
  - `src/screens/chat/utils.ts.backup2`
  - `src/screens/chat/utils.ts.bak`

## Steps
1. Add a dedicated `.gitignore` section for local auto-improvement scratch artifacts.
2. Ignore known local sentinels (`MOBILE_FIX_SUMMARY.md`, `REVIEW_APPROVED`), one-off async fix scripts, and backup suffixes (`*.bak`, `*.backup*`).
3. Remove the stale untracked files that match those artifacts plus the bogus duplicate `src/screens/chat/chat-header.tsx` placeholder.
4. Verify `git status --short` shows only intentional tracked changes.
5. Run TypeScript compilation under Node 22 and a focused shell verification that ignored scratch artifacts stay ignored.

## How to verify the change works
- `PATH=/home/ubuntu/.hermes/node/bin:$PATH npx tsc --noEmit` exits 0.
- `git status --short --untracked-files=all` no longer lists the stale scratch files.
- `git check-ignore -v MOBILE_FIX_SUMMARY.md REVIEW_APPROVED fix_async.py src/lib/utils.ts.bak src/screens/chat/components/sister-picker.tsx.backup` reports the new `.gitignore` rules.

## Rollback procedure
Revert the generated `auto-improve: ignore local scratch artifacts` commit. If any local scratch files are genuinely needed again, recover them from shell history, editor backups, or the previous untracked worktree before cleanup.
