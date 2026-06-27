# Plan: Structured Task Clarification Flow

## Summary of the change

Ship a structured clarification workflow for Hermes Workspace tasks. When an agent needs user input, it can emit multiple questions with optional answer choices. The workspace stores those questions, shows a guided Q&A panel in the task dialog, supports `/tasks?task=<id>` deep links from notifications, accepts Telegram inline-button/freeform replies, and resumes the original agent run only after the user confirms the answers.

## Files to modify

- `src/lib/tasks-api.ts` — shared clarification types and client submission helper.
- `src/server/tasks-store.ts` — persisted task clarification state and notification bookkeeping fields.
- `src/server/astra-tasks.ts` — parse structured `QUESTIONS:` blocks, mark tasks as waiting for user input, and send clarification/done notifications.
- `src/server/telegram-clarify.ts` — Telegram Bot API helper for clarification messages, reminders, progress pings, and done/blocked notifications.
- `src/routes/api/hermes-tasks.$taskId.ts` — add `action=clarify` submission path for web dialog answers.
- `src/routes/api/telegram-task-clarify.ts` — handle Telegram option clicks, freeform replies, edit-answer callbacks, and confirm-to-resume callbacks.
- `src/routes/api/tasks-clarify-nudge.ts` — reminder sweep endpoint for stale clarification waits.
- `src/routes/api/tasks-progress-ping.ts` — progress ping endpoint for long-running working tasks.
- `src/routes/tasks.tsx` — accept `task` search param.
- `src/screens/tasks/tasks-screen.tsx` — auto-open deep-linked tasks and wire clarification submission.
- `src/screens/tasks/task-dialog.tsx` — guided structured clarification panel.
- `src/screens/tasks/task-card.tsx` — waiting/clarification visual affordances.
- `src/routeTree.gen.ts` — generated TanStack route tree for new API routes.

## Steps

1. Add `ClarificationQuestion` types to the client and server task models, preserving optional fields during task normalization.
2. Teach agent execution parsing to recognize structured question arrays and persist them when the agent blocks for input.
3. Add reusable Telegram clarification helpers that render pending, confirm, reminder, and done states without logging secrets.
4. Add API routes for web clarification submission, Telegram callback/reply handling, stale clarification reminders, and progress pings.
5. Add task-screen deep-link behavior and a dialog Q&A panel that collects option and custom/freeform answers.
6. Verify TypeScript, focused lint, unit tests, production build, and JSON health after restart.
7. Commit the intended workspace changes only; do not push from the cron loop.

## How to verify the change works

- `export PATH=/home/ubuntu/.hermes/node/bin:$PATH && npx tsc --noEmit`
- `pnpm test` (record known environment/config collection failures separately if unrelated)
- `pnpm lint` plus focused lint on changed files; document strict baseline debt if the new flow compiles and focused mechanical errors are fixed.
- `pnpm build`
- Restart `hermes-workspace.service` only because source files changed, then verify `https://agent.fernandofamily.com/api/health` returns HTTP 200, `application/json`, and `{ "status": "ok" }`.

## Rollback procedure

Revert the auto-improvement commit on the local branch, rebuild the workspace, restart `hermes-workspace.service`, and re-run the JSON health check. Existing task records keep unknown JSON fields harmlessly, but the UI and notification routes will stop using them after rollback.
