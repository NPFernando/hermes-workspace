/**
 * Blocker System API — manage task blockers, collect credentials, resolve dependencies.
 *
 * GET  /api/tasks-blockers           — list all blockers grouped by type
 * POST /api/tasks-blockers/resolve   — resolve a blocker (unblock task)
 * POST /api/tasks-blockers/provide-credential — supply a credential value
 * POST /api/tasks-blockers/auto-resume — check dependency completion and auto-resume
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getTask, listTasks, updateTask } from '../../server/tasks-store'
import { safeErrorMessage } from '../../server/rate-limit'
import type { TaskRecord } from '../../server/tasks-store'

type BlockerGroup = {
  type: string
  label: string
  icon: string
  tasks: Array<TaskRecord>
}

// ── Helpers ────────────────────────────────────────────────────────────────

function groupBlockers(tasks: Array<TaskRecord>): Array<BlockerGroup> {
  const credential: Array<TaskRecord> = []
  const dependency: Array<TaskRecord> = []
  const execution: Array<TaskRecord> = []
  const input: Array<TaskRecord> = []
  const environment: Array<TaskRecord> = []
  const unknown: Array<TaskRecord> = []

  for (const t of tasks) {
    switch (t.blocker_type) {
      case 'credential':  credential.push(t); break
      case 'dependency':  dependency.push(t); break
      case 'execution':   execution.push(t); break
      case 'input':       input.push(t); break
      case 'environment': environment.push(t); break
      default:            unknown.push(t); break
    }
  }

  const groups: Array<BlockerGroup> = []
  if (credential.length > 0)  groups.push({ type: 'credential',  label: 'Credentials Needed',   icon: '🔑', tasks: credential })
  if (dependency.length > 0)  groups.push({ type: 'dependency',  label: 'Dependency Blockers',   icon: '🔗', tasks: dependency })
  if (execution.length > 0)   groups.push({ type: 'execution',   label: 'Execution Failures',    icon: '⚠️', tasks: execution })
  if (input.length > 0)       groups.push({ type: 'input',       label: 'Awaiting Input',        icon: '💬', tasks: input })
  if (environment.length > 0) groups.push({ type: 'environment', label: 'Environment Issues',    icon: '🖥️', tasks: environment })
  if (unknown.length > 0)     groups.push({ type: 'unknown',     label: 'Other Blockers',        icon: '🚫', tasks: unknown })
  return groups
}

function getEnvFilePath(): string {
  const home = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
  const possible = [
    path.join(home, '.env'),
    path.join(os.homedir(), 'hermes-workspace', '.env'),
    path.join(os.homedir(), '.hermes', '.env'),
  ]
  for (const p of possible) {
    if (fs.existsSync(p)) return p
  }
  return possible[0]
}

function upsertEnvVar(key: string, value: string): void {
  const envPath = getEnvFilePath()
  let content = ''
  try {
    content = fs.readFileSync(envPath, 'utf-8')
  } catch {
    content = ''
  }

  const lines = content.split('\n')
  const existingIdx = lines.findIndex((l) => l.startsWith(`${key}=`))
  if (existingIdx >= 0) {
    lines[existingIdx] = `${key}=${value}`
  } else {
    lines.push(`${key}=${value}`)
  }

  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8')
}

function verifyCredentialExists(key: string): boolean {
  const value = process.env[key]
  if (value) return true
  try {
    const envPath = getEnvFilePath()
    const content = fs.readFileSync(envPath, 'utf-8')
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return !!match?.[1]?.trim()
  } catch {
    return false
  }
}

// ── Resolve a dependency blocker: check if depends_on tasks are done ────────
function checkDependencyCompletion(task: TaskRecord): { allDone: boolean; pending: Array<string> } {
  const deps = task.depends_on ?? []
  const allTasks = listTasks({ includeDone: true })
  const depMap = new Map(allTasks.map((t) => [t.id, t]))

  const pending: Array<string> = []
  for (const depId of deps) {
    const dep = depMap.get(depId)
    if (!dep || dep.column !== 'done') {
      pending.push(dep?.title ?? depId)
    }
  }

  return { allDone: pending.length === 0, pending }
}

// ── Auto-resume: find tasks whose depends_on are all done and offer to unblock ─
function findResumableTasks(): Array<{ task: TaskRecord; pending: Array<string> }> {
  const blocked = listTasks({ column: 'blocked' })
  const resumable: Array<{ task: TaskRecord; pending: Array<string> }> = []

  for (const t of blocked) {
    if (t.blocker_type === 'dependency') {
      const { allDone, pending } = checkDependencyCompletion(t)
      if (allDone) resumable.push({ task: t, pending: [] })
    }
  }

  return resumable
}

// ── Route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/tasks-blockers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const blocked = listTasks({ column: 'blocked' })
        const groups = groupBlockers(blocked)
        const resumable = findResumableTasks()
        const count = blocked.length

        return json({
          ok: true,
          count,
          groups,
          resumable: resumable.map((r) => ({
            id: r.task.id,
            title: r.task.title,
            blocker_type: r.task.blocker_type,
            blocker_reason: r.task.blocker_reason,
          })),
        })
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          const action = body.action as string | undefined

          if (!action) {
            return json({ ok: false, error: 'action is required' }, { status: 400 })
          }

          // ── Resolve a blocker ──────────────────────────────────────────────
          if (action === 'resolve') {
            const taskId = body.task_id as string | undefined
            if (!taskId) {
              return json({ ok: false, error: 'task_id is required' }, { status: 400 })
            }

            const task = getTask(taskId)
            if (!task) {
              return json({ ok: false, error: 'Task not found' }, { status: 404 })
            }

            // Clear blocker fields and move to todo
            const updated = updateTask(taskId, {
              column: 'todo',
              blocker_type: undefined,
              blocker_reason: undefined,
              blocked_since: undefined,
              credentials_needed: undefined,
              resolved_by_task: undefined,
              agent_history: [
                ...(task.agent_history ?? []),
                {
                  id: crypto.randomUUID(),
                  by: 'user',
                  byEmoji: '👤',
                  action: 'unblocked',
                  note: 'Blocker resolved — task unblocked',
                  at: new Date().toISOString(),
                },
              ],
            })

            return json({ ok: true, task: updated })
          }

          // ── Provide a credential value ──────────────────────────────────────
          if (action === 'provide_credential') {
            const taskId = body.task_id as string | undefined
            const credentialKey = body.credential_key as string | undefined
            const credentialValue = body.credential_value as string | undefined

            if (!taskId || !credentialKey || !credentialValue) {
              return json({
                ok: false,
                error: 'task_id, credential_key, and credential_value are required',
              }, { status: 400 })
            }

            const task = getTask(taskId)
            if (!task) {
              return json({ ok: false, error: 'Task not found' }, { status: 404 })
            }

            // Write credential to .env file (never store in tasks.json)
            upsertEnvVar(credentialKey, credentialValue)

            // Mark credential as provided in the task
            const credentials = (task.credentials_needed ?? []).map((c) =>
              c.key === credentialKey
                ? { ...c, provided: true, provided_at: new Date().toISOString(), validated: false }
                : c
            )

            // Check if all credentials are now provided
            const allProvided = credentials.every((c) => c.provided)

            const updates: Record<string, unknown> = {
              credentials_needed: credentials,
            }

            if (allProvided) {
              updates.blocker_reason = 'Credentials provided, pending validation'
              updates.agent_history = [
                ...(task.agent_history ?? []),
                {
                  id: crypto.randomUUID(),
                  by: 'user',
                  byEmoji: '👤',
                  action: 'credential_provided',
                  note: `Credential "${credentialKey}" provided. All credentials collected — run validation to unblock.`,
                  at: new Date().toISOString(),
                },
              ]
            } else {
              const remaining = credentials.filter((c) => !c.provided).map((c) => c.label).join(', ')
              updates.agent_history = [
                ...(task.agent_history ?? []),
                {
                  id: crypto.randomUUID(),
                  by: 'user',
                  byEmoji: '👤',
                  action: 'credential_provided',
                  note: `Credential "${credentialKey}" provided. Still need: ${remaining}`,
                  at: new Date().toISOString(),
                },
              ]
            }

            const updated = updateTask(taskId, updates)
            return json({
              ok: true,
              all_provided: allProvided,
              task: updated,
            })
          }

          // ── Validate credentials for a task ────────────────────────────────
          if (action === 'validate') {
            const taskId = body.task_id as string | undefined
            if (!taskId) {
              return json({ ok: false, error: 'task_id is required' }, { status: 400 })
            }

            const task = getTask(taskId)
            if (!task) {
              return json({ ok: false, error: 'Task not found' }, { status: 404 })
            }

            const credentials = task.credentials_needed ?? []
            const results = credentials.map((c) => ({
              key: c.key,
              label: c.label,
              exists: verifyCredentialExists(c.key),
            }))

            const allValid = results.every((r) => r.exists)

            // Update credential validated status
            const updatedCredentials = credentials.map((c) => ({
              ...c,
              validated: results.find((r) => r.key === c.key)?.exists ?? false,
            }))

            const updates: Record<string, unknown> = {
              credentials_needed: updatedCredentials,
            }

            if (allValid) {
              updates.blocker_reason = undefined
              updates.blocker_type = undefined
              updates.blocked_since = undefined
              updates.column = 'todo'
              updates.agent_history = [
                ...(task.agent_history ?? []),
                {
                  id: crypto.randomUUID(),
                  by: 'user',
                  byEmoji: '👤',
                  action: 'validated',
                  note: 'All credentials validated and present — task unblocked',
                  at: new Date().toISOString(),
                },
              ]
            } else {
              const failed = results.filter((r) => !r.exists).map((r) => r.label).join(', ')
              updates.agent_history = [
                ...(task.agent_history ?? []),
                {
                  id: crypto.randomUUID(),
                  by: 'astra',
                  byEmoji: '🌟',
                  action: 'validated',
                  note: `Validation failed for: ${failed}. Check the values and try again.`,
                  at: new Date().toISOString(),
                },
              ]
            }

            const updated = updateTask(taskId, updates)
            return json({ ok: true, all_valid: allValid, results, task: updated })
          }

          // ── Auto-resume: unblock all tasks whose dependencies are done ──────
          if (action === 'auto_resume') {
            const resumable = findResumableTasks()
            const unblocked: Array<{ id: string; title: string }> = []

            for (const { task } of resumable) {
              updateTask(task.id, {
                column: 'todo',
                blocker_type: undefined,
                blocker_reason: undefined,
                blocked_since: undefined,
                resolved_by_task: undefined,
                agent_history: [
                  ...(task.agent_history ?? []),
                  {
                    id: crypto.randomUUID(),
                    by: 'astra',
                    byEmoji: '🌟',
                    action: 'auto_resumed',
                    note: 'All dependencies completed — auto-unblocked',
                    at: new Date().toISOString(),
                  },
                ],
              })
              unblocked.push({ id: task.id, title: task.title })
            }

            return json({ ok: true, unblocked })
          }

          return json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
        } catch (err) {
          return json({ ok: false, error: safeErrorMessage(err) }, { status: 500 })
        }
      },
    },
  },
})
