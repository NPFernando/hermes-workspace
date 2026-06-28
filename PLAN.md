# Plan: Improve task filter accessibility semantics

## Summary of the change

Improve the Workspace Tasks filter bar by adding machine-readable pressed states and descriptive ARIA labels to interactive filter controls. This keeps the existing visual design while making the task filters and clear-search affordance clearer for keyboard and assistive-technology users.

## Files to modify

- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/tasks-ux.test.ts`

## Steps

1. Add a small exported helper in `src/screens/tasks/tasks-screen.tsx` that formats filter button ARIA labels from a label and active state.
2. Use the helper on quick-filter chips and priority filter chips.
3. Add `aria-pressed` to toggle-style filter buttons.
4. Add an explicit `aria-label` to the search clear button.
5. Add focused Vitest assertions in `src/screens/tasks/tasks-ux.test.ts` for the helper copy so the accessibility semantics stay stable.
6. Run TypeScript, focused tests, lint/build gates, and whitespace checks.

## How to verify the change works

- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH`
- `cd /home/ubuntu/hermes-workspace && npx tsc --noEmit`
- `cd /home/ubuntu/hermes-workspace && npx vitest run src/screens/tasks/tasks-ux.test.ts`
- `cd /home/ubuntu/hermes-workspace && npx eslint --no-warn-ignored -f json src/screens/tasks/tasks-screen.tsx src/screens/tasks/tasks-ux.test.ts`
- `cd /home/ubuntu/hermes-workspace && pnpm build`
- `cd /home/ubuntu/hermes-workspace && git diff --check`

## Rollback

Revert the auto-improvement commit. The change is isolated to Workspace Tasks UI semantics and its focused UX test.
