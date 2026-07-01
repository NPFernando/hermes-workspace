# Plan: Make task card selection controls keyboard accessible

## Summary
Replace the Tasks card bulk-select click targets with native buttons that expose explicit selection labels. The current dense and expanded TaskCard selection squares are clickable `<div>` wrappers, so keyboard and screen-reader users cannot toggle selection without opening the task card.

## Files to modify
- `src/screens/tasks/task-card.tsx`
- `src/screens/tasks/tasks-ux.test.ts`

## Steps
1. Add an exported helper that formats task selection toggle labels from the card title and selected state.
2. Use that helper for both dense and expanded TaskCard bulk-select controls.
3. Replace each clickable selection wrapper `<div>` with `<button type="button">`, preserving the visual square and stopping propagation so the card itself does not open.
4. Add focused Vitest coverage for the helper copy.
5. Verify with TypeScript, focused Vitest, focused ESLint, diff whitespace checks, class-token smoke, build, service restart, and JSON health validation.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `npx eslint --no-warn-ignored -f json --rule '@typescript-eslint/no-unnecessary-condition: off' src/screens/tasks/task-card.tsx src/screens/tasks/tasks-ux.test.ts`
- `git diff --check`
- `pnpm -s lint:class-tokens`
- `pnpm build`
