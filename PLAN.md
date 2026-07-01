# Plan: Add named action labels for scheduled job cards

## Summary
Improve Jobs screen accessibility by giving each icon-only job card action a job-specific accessible name. The UI already exposed visual `title` text, but assistive technology benefits from explicit labels that include the affected job and current action state.

## Files to modify
- `src/screens/jobs/jobs-screen.tsx`
- `src/screens/jobs/jobs-screen.test.ts`

## Steps
1. Add an exported `formatJobActionLabel` helper that accepts a job title and action key.
2. Use the helper for Run, Pause/Resume, Edit, Show/Hide history, and Delete icon buttons in `JobCard`.
3. Preserve existing visual styling, button behavior, and `title` tooltips.
4. Add focused Vitest coverage for named and blank job title label copy.
5. Verify with TypeScript, focused Vitest, focused ESLint, diff whitespace checks, build, service restart, and JSON health validation.

## How to verify the change works
- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`
- `npx vitest run src/screens/jobs/jobs-screen.test.ts`
- `npx eslint --no-warn-ignored -f json src/screens/jobs/jobs-screen.tsx src/screens/jobs/jobs-screen.test.ts`
- `git diff --check -- src/screens/jobs/jobs-screen.tsx src/screens/jobs/jobs-screen.test.ts IDEAS.json PLAN.md`
- `pnpm build`
- `sudo systemctl restart hermes-workspace.service` followed by JSON health validation
