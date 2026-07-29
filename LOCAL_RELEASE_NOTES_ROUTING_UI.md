# Local release notes — chat routing and UI hardening

Status: local-only. Do not push or open a PR without explicit approval.

## Commits

- `443e56c2 fix(chat): harden strict indexed access`
- `bfe91809 fix(ui): harden strict indexed access`
- `e205649f feat(chat): explain sister routing state`
- `2a423de1 fix(chat): announce sister handoff status`
- `ca86328a fix(chat): preserve waiting state across run updates`
- `81c4d677 feat(chat): improve screen reader status updates`
- `4857a44e perf(chat): lazy-load optional chat panels`
- `3d35ab26 test(e2e): require completed session fixture`

## Delivered

- Strict indexed-access repairs for chat, Files UI, Gateway office view, sidebar, and onboarding.
- Explainable SisterPicker routing: route rationale, confidence label, routing/idle/failed status, and session-scoped manual override persistence.
- Accessible live announcements for routing and handoff failure; accessible retry control label.
- Preserved waiting timestamps across refreshed chat run IDs, preventing false “just started” status.
- Screen-reader progress/status semantics, unread-aware scroll control, and keyboard-visible session controls.
- Deferred ChatSidebar and ArtifactPanel chunks so non-chat routes avoid eager chat UI cost.
- Reproducible stale-thinking E2E fixture: no hard-coded session IDs.

## Verified locally

- Full TypeScript check passed.
- Production `pnpm build` passed.
- Focused SisterPicker tests passed: 5/5.
- Chat-store regression tests passed: 3/3.
- Chat/session component tests passed: 10/10.
- Playwright discovery passed: 7 tests across 3 specs.
- Commit whitespace checks passed for the commits above.

## Known verification boundary

Authenticated thinking-state Playwright E2E is read-only for chat data but has not run because this shell lacks the required completed-session key and authenticated storage-state path. It must use explicitly authorized production credentials/session inputs, never log or commit them, and must not send messages.

## Private-fork / draft-PR checklist

1. Review each commit with `git show --check <commit>`.
2. Confirm the dirty worktree contains no intended changes for this release.
3. Push only the reviewed commit range to Naveen's private `origin` fork.
4. Open a draft PR only; do not merge or publish.
5. Attach build/typecheck/test results and the E2E verification boundary.
