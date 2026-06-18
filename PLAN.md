# Auto-Improvement Plan: Fix APK download API TypeScript body handling

## Summary of the change

The current PWA/TWA branch adds `/api/download-apk`, but `npx tsc --noEmit` fails because the route passes a Node `Buffer` directly to `new Response(...)`. The DOM `Response` type expects a `BodyInit`, and this repository's TypeScript configuration does not accept `Buffer` as a body. The improvement is to convert the file bytes to a `Uint8Array` before constructing the response while preserving the existing authentication, content type, filename, content length, and no-store cache behavior.

## Files to modify

- `src/routes/api/download-apk.ts`
- `IDEAS.json`
- `PLAN.md`
- `TEST_REPORT.json`
- `CLOSE_SUMMARY.md`

## Steps

1. In `src/routes/api/download-apk.ts`, keep reading the APK with `fs.readFile`.
2. Convert the `Buffer` to a `Uint8Array` (or equivalent `ArrayBuffer`-backed body) before passing it to `new Response(...)`.
3. Keep `Content-Length` based on the original byte length so clients receive a correct download size.
4. Run `npx tsc --noEmit` from `/home/ubuntu/hermes-workspace`.
5. Run the project test command and lint command, or capture scoped fallback results if the full commands fail because of pre-existing repository-wide issues.
6. Commit the resulting workspace changes on the current branch with an `auto-improve:` commit message.

## How to verify the change works

- `cd /home/ubuntu/hermes-workspace && npx tsc --noEmit` exits 0.
- `cd /home/ubuntu/hermes-workspace && pnpm test` result is captured in `TEST_REPORT.json`.
- `cd /home/ubuntu/hermes-workspace && pnpm lint` result is captured in `TEST_REPORT.json` with an explicit lint error count.
- `git -C /home/ubuntu/hermes-workspace log --oneline -1` shows an `auto-improve:` commit.

## Rollback procedure

Run `git -C /home/ubuntu/hermes-workspace revert HEAD` to undo the auto-improvement commit, or restore only `src/routes/api/download-apk.ts` from the previous commit if the artifact updates should be retained.
