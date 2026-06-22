# Close Summary: Mobile viewport ergonomics hardening

## What changed
- Converted responsive workspace surfaces from fixed `vh` sizing to dynamic `dvh` sizing across modals, drawers, panels, image previews, chat, dashboard, gateway, memory, skills, swarm, task, and file surfaces under `src/`.
- Added touch-only CSS in `src/styles.css` for readable tiny arbitrary text utilities, nested scroller overscroll containment, and immediate active-state press feedback.
- Preserved screenshot smoke leftovers as untracked artifacts; they were deliberately not staged.

## Test results
- `git diff --check`: passed.
- `npx tsc --noEmit` with Hermes Node v22.22.3: passed.
- `pnpm test`: passed — 111 test files and 718 tests.
- `pnpm build`: passed.
- `pnpm lint`: failed on known repository baseline strict lint debt (201 errors, 37 warnings). Focused changed-file lint also reports inherited lint debt unrelated to this cycle's viewport-unit/className and CSS-only changes; details are in `TEST_REPORT.json`.

## Deployment and side effects
- The latest commit touches `src/`, so the verified current worktree was built, `hermes-workspace.service` was restarted, and external health was validated as HTTP 200 `application/json` with `{"status":"ok"}`.
- The current branch remains diverged from `origin/main` (`HEAD...origin/main` reported 9 ahead / 1 behind), so I did not merge into `main` or push.
- Remaining untracked files are viewport screenshot artifacts under `screenshots/` plus `scripts/screenshot-viewports.cjs`.

## New improvement ideas
- Add a viewport CSS smoke assertion for `dvh` utilities.
- Create an ignored visual-smoke artifact directory.
- Baseline and ratchet workspace ESLint debt.
