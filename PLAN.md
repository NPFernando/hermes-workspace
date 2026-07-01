# Plan: Make Tasks stat filters keyboard accessible

## Summary
Convert the Tasks header clickable stat text into proper buttons with explicit accessible labels. The current blocked count uses a `<span>` with `onClick`, which is not keyboard reachable and has no role/name beyond visible text.

## Files to modify
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`

## Steps
1. Add a small exported helper that formats stat filter button labels from a stat name and active state.
2. Use that helper for the blocked and timed-out header controls.
3. Replace the clickable blocked `<span>` with a semantic `<button type="button">` while preserving visual styling and title copy.
4. Add focused Vitest coverage for the helper copy.
5. Verify with TypeScript, focused Vitest, focused ESLint, diff whitespace checks, class-token smoke, build, service restart, and JSON health validation.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`
- `npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `npx eslint --no-warn-ignored -f json --rule '@typescript-eslint/no-unnecessary-condition: off' src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts`
- `git diff --check`
- `pnpm -s lint:class-tokens`
- `pnpm build`
