# Feature Plan: Maia‑Driven Automatic Task Management

**Goal**: Enable Maia (the Task‑Manager sister) to automatically create, update, and complete tasks in the Hermes Workspace task board based on ideas in `IDEAS.json` and delegation outcomes, so the UI reflects the continuous‑improvement loop without manual intervention.

## Scope
- Modify the Task‑Manager sister (`sisters/task-manager`) to interact with the tasks API.
- Ensure the task board (`src/screens/tasks/tasks-screen.tsx`) reflects Maia‑generated tasks in real time.
- Keep changes localized to the workspace (`/home/ubuntu/hermes-workspace`) and the sister skill.

## High‑Level Steps
1. **Idea Ingestion** – Maia reads `/home/ubuntu/hermes-workspace/IDEAS.json` (unchanged).
2. **Delegation** – For each un‑processed idea, Maia delegates to the appropriate sister (Nova, Atlas, Analyst, Coder) as today.
3. **Task Creation** – After delegation, Maia creates a task via `POST /api/tasks` with:
   - `title`: idea.title
   - `description`: idea.description + `\n\nDelegated to: {sister_name}`
   - `status`: `todo`
   - `priority`: map `estimated_effort` (low→P3, medium→P2, high→P1)
   - `tags`: `[\"idea\", \"auto‑generated\", sister_name]`
   - `project`: `hermes-workspace-improvement`
   - `missionId`: optional (could be a generated UUID for the improvement loop)
4. **Task Completion** – When the delegated sister finishes work (signaled by updating the idea’s `processed` flag and optionally a `result_summary`), Maia updates the task via `PATCH /api/tasks/:id` to set `status` to `done`.
5. **Real‑Time Sync** – Optionally, enhance the task store to listen for server‑sent events or use a lightweight polling interval (e.g., every 15 s) to keep the UI up‑to‑date with Maia‑made changes.
6. **Cleanup** – After a task is marked done, Maia may optionally archive the idea (remove from `IDEAS.json` or move to an `IDEAS_DONE.json`).

## Files to Modify
- `/home/ubuntu/hermes-workspace/src/stores/task-store.ts` – add a method `subscribeToUpdates` (or increase polling frequency) if real‑time sync is desired.
- `/home/ubuntu/hermes-workspace/src/screens/tasks/tasks-screen.tsx` – no changes required if we rely on existing refetch interval (30 s); we can reduce it to 10 s for fresher data.
- `/home/ubuntu/hermes-workspace/src/stores/task-store.ts` – adjust `refetchInterval` in the `tasksQuery` (used in TasksScreen) to a shorter interval (e.g., 10_000) for quicker updates.
- `/home/ubuntu/hermes-workspace/src/stores/task-store.ts` – (optional) add a websocket listener if the backend supports it.
- `/home/ubuntu/hermes-workspace/src/sisters/task-manager/sister.py` – extend `_delegate_to_sister` and `_process_new_ideas` to call the tasks API via HTTP (using `requests` or `fetch` if available) or delegate to a terminal‑based curl command (if terminal access is granted).

## Implementation Details (Task‑Manager Sister)
- Import `requests` (if available) or use the existing `hermes_tools.terminal` to run `curl` against the local workspace API (`http://127.0.0.1:3000/api/tasks`).
- Example pseudo‑code for task creation:
  ```python
  import json, requests
  def _create_task(idea, sister_name):
      payload = {
          "title": idea["title"],
          "description": f"{idea['description']}\n\nDelegated to: {sister_name}",
          "status": "todo",
          "priority": {"low":"P3","medium":"P2","high":"P1"}[idea.get("estimated_effort","medium")],
          "tags": ["idea", "auto-generated", sister_name],
          "project": "hermes-workspace-improvement",
          "missionId": "auto-improve-loop"
      }
      r = requests.post("http://127.0.0.1:3000/api/tasks", json=payload)
      return r.json() if r.ok else None
  ```
- After delegation, store the returned task ID in the idea object (`idea["task_id"]`) to later update.
- For completion, call `PATCH /api/tasks/{task_id}` with `{ "status": "done" }`.

## Acceptance Criteria
1. When a new idea is added to `IDEAS.json`, a corresponding task appears in the Tasks board under the To Do column within ≤ 10 seconds (subject to sync interval).
2. When the Task‑Manager sister marks an idea as processed, the linked task moves to the Done column.
3. Tasks created by Maia are tagged with `auto-generated` and `idea` and appear correctly in the UI.
4. Manual task creation and editing continue to work as before.
5. No regression in existing functionality (e.g., deleting tasks, updating manually) is observed.
6. The feature can be toggled via a configuration flag (e.g., `MAIA_AUTO_TASKS=true`) in the sister’s config if desired.

## Risks & Mitigations
- **API Availability**: If the workspace API server is not running, task creation will fail. Mitigation: Maia should log the error and retry later; the idea remains unprocessed so the next coordination attempt can retry.
- **Duplicate Tasks**: Ensure Maia checks for existing tasks linked to an idea (via `idea.get("task_id")`) before creating a new one.
- **Conflict with Manual Edits**: If a user manually changes a Maia‑generated task, the sister’s update (`status: done`) will overwrite it only if the idea is processed; this is acceptable as the autonomous flow has priority for completed ideas.
- **Network Overhead**: Increased HTTP traffic is minimal (one request per idea per state change).

## Next Steps
1. Implement the HTTP‑call capability in the Task‑Manager sister (use `requests` if installed, otherwise fall back to `terminal` + `curl`).
2. Adjust the task store’s refetch interval to 10 s for fresher UI updates.
3. Test the end‑to‑end flow: add an idea to `IDEAS.json`, run Maia’s coordination, verify task appears and transitions to Done.
4. Optionally, add a configuration switch to enable/disable the feature.

--- 

*Prepared by Maia (Task‑Manager sister) for the Hermes Workspace continuous‑improvement loop.* 