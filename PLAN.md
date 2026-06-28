# Plan: Full-width workspace surfaces and task board quick actions

## Summary of the change

Use the existing local implementation candidate to make dense workspace screens use the available viewport width and make the Tasks board faster to operate. The change removes unnecessary 1200px max-width wrappers on several screens, promotes Jobs and Research results into roomier layouts, and refines the Tasks board header/actions/quick-add behavior so the Done column remains visible while secondary controls move into an overflow menu.

## Files to modify

- `src/routes/profiles.tsx`
- `src/screens/echo-studio/echo-studio-screen.tsx`
- `src/screens/gateway/agents-screen.tsx`
- `src/screens/jobs/jobs-screen.tsx`
- `src/screens/mcp/mcp-screen.tsx`
- `src/screens/memory/knowledge-browser-screen.tsx`
- `src/screens/research/research-screen.tsx`
- `src/screens/skills/skills-screen.tsx`
- `src/screens/tasks/tasks-screen.tsx`
- `src/server/astra-tasks.ts`
- `src/server/tasks-store.ts`

## Steps

1. Treat the pre-existing dirty workspace changes as the implementation candidate for this cycle rather than inventing a duplicate UI idea.
2. Verify the diff is limited to Hermes workspace UI/task backend files and the pre-existing `services/odysseus` gitlink remains unstaged.
3. Keep Done tasks visible in the Tasks board, consolidate secondary board actions into the menu, and add quick-add controls for columns.
4. Expand dense screens by removing max-width wrappers and tightening screen-specific layouts where useful.
5. Write this plan, run TypeScript/build/test/lint gates, and record baseline failures separately from changed-file regressions.
6. Commit the intended source files plus cycle artifacts locally. Do not push.
7. If source files changed, build, restart `hermes-workspace.service`, and validate `/api/health` returns JSON with `status: ok`.

## How to verify the change works

- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit --pretty false`
- `pnpm test` with any known collection/config baseline failures documented in `TEST_REPORT.json`
- `pnpm lint` or a focused ESLint fallback on changed files, documenting known baseline strict-type debt separately
- `pnpm build`
- `git diff --check`
- Bounded JSON health check against `https://agent.fernandofamily.com/api/health` after restart

## Rollback procedure

Use `git revert <auto-improve-commit>` from `/home/ubuntu/hermes-workspace`, rebuild with `pnpm build`, restart `hermes-workspace.service`, and re-run the JSON health check.
