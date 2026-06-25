import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type TaskColumn = 'backlog' | 'todo' | 'in_progress' | 'review' | 'blocked' | 'done' | 'deleted'
export type TaskPriority = 'high' | 'medium' | 'low'

export type TaskAgentState = 'reviewing' | 'delegating' | 'working' | 'waiting_for_input' | null
export type TaskSource = 'human' | 'idea_job' | 'astra' | null

export type ActivityEntry = {
  id: string
  by: string
  byEmoji: string
  action: string
  note: string
  at: string
}

export type TaskRecord = {
  id: string
  title: string
  description: string
  column: TaskColumn
  priority: TaskPriority
  assignee: string | null
  tags: Array<string>
  due_date: string | null
  position: number
  created_by: string
  created_at: string
  updated_at: string
  session_id?: string | null
  agent_state?: TaskAgentState
  agent_name?: string | null
  agent_action_at?: string | null
  source?: TaskSource
  agent_comment?: string | null
  agent_history?: Array<ActivityEntry>
  waiting_for_user?: boolean
}

type TaskFile = { tasks: Array<TaskRecord> }

type TaskFilters = {
  column?: string | null
  assignee?: string | null
  priority?: string | null
  includeDone?: boolean
}

export type CreateTaskInput = Partial<TaskRecord> & { title: string }
export type UpdateTaskInput = Partial<Omit<TaskRecord, 'id' | 'created_at' | 'created_by'>>

const CLAUDE_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const TASKS_FILE = path.join(CLAUDE_HOME, 'tasks.json')
const LOCK_FILE  = TASKS_FILE + '.lock'

// Cross-process advisory lock so background .mjs scripts and the SSR server
// never write tasks.json at the same time. Lock is a plain exclusive file;
// stale locks (> 30 s) are removed so a killed process can't block forever.
// Uses a sync busy-wait — acceptable because the lock is held for < 10 ms.
function withTasksLock<T>(fn: () => T): T {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(LOCK_FILE, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL)
      fs.closeSync(fd)
      try {
        return fn()
      } finally {
        try { fs.unlinkSync(LOCK_FILE) } catch { /* non-fatal */ }
      }
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      // Remove stale locks left by killed processes
      try {
        const stat = fs.statSync(LOCK_FILE)
        if (Date.now() - stat.mtimeMs > 30_000) { fs.unlinkSync(LOCK_FILE); continue }
      } catch { /* ok */ }
      const end = Date.now() + 50
      while (Date.now() < end) { /* busy-wait 50 ms */ }
    }
  }
  // Timeout — proceed without lock rather than deadlock
  return fn()
}

function ensureTasksFile(): void {
  fs.mkdirSync(CLAUDE_HOME, { recursive: true })
  if (!fs.existsSync(TASKS_FILE)) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify({ tasks: [] }, null, 2) + '\n', 'utf-8')
  }
}

function readTaskFile(): TaskFile {
  ensureTasksFile()
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8').trim()
    if (!raw) return { tasks: [] }
    const parsed = JSON.parse(raw) as Partial<TaskFile>
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
  } catch {
    return { tasks: [] }
  }
}

function writeTaskFile(data: TaskFile): void {
  ensureTasksFile()
  const content = JSON.stringify(data, null, 2) + '\n'
  const tmp = TASKS_FILE + '.tmp'
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, TASKS_FILE)
}

function normalizeTask(task: Partial<TaskRecord> & Pick<TaskRecord, 'id' | 'title' | 'created_at' | 'updated_at' | 'created_by'>): TaskRecord {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    column: task.column ?? 'backlog',
    priority: task.priority ?? 'medium',
    assignee: task.assignee ?? null,
    tags: Array.isArray(task.tags) ? task.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    due_date: task.due_date ?? null,
    position: typeof task.position === 'number' ? task.position : 0,
    created_by: task.created_by,
    created_at: task.created_at,
    updated_at: task.updated_at,
    session_id: task.session_id ?? null,
    agent_state: task.agent_state ?? null,
    agent_name: task.agent_name ?? null,
    agent_action_at: task.agent_action_at ?? null,
    source: task.source ?? null,
    agent_comment: task.agent_comment ?? null,
    agent_history: Array.isArray(task.agent_history) ? task.agent_history : [],
    waiting_for_user: task.waiting_for_user ?? false,
  }
}

export function listTasks(filters: TaskFilters = {}): Array<TaskRecord> {
  let tasks = readTaskFile().tasks.map(normalizeTask)
  if (!filters.includeDone) {
    tasks = tasks.filter((task) => task.column !== 'done')
  }
  if (filters.column) {
    tasks = tasks.filter((task) => task.column === filters.column)
  }
  if (filters.assignee) {
    tasks = tasks.filter((task) => task.assignee === filters.assignee)
  }
  if (filters.priority) {
    tasks = tasks.filter((task) => task.priority === filters.priority)
  }
  return tasks.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
}

export function getTask(taskId: string): TaskRecord | null {
  return readTaskFile().tasks.map(normalizeTask).find((task) => task.id === taskId) ?? null
}

export function createTask(input: CreateTaskInput): TaskRecord {
  return withTasksLock(() => {
    const file = readTaskFile()
    const now = new Date().toISOString()
    const task = normalizeTask({
      id: typeof input.id === 'string' && input.id ? input.id : randomUUID(),
      title: input.title,
      description: input.description,
      column: input.column,
      priority: input.priority,
      assignee: input.assignee,
      tags: input.tags,
      due_date: input.due_date,
      position: typeof input.position === 'number' ? input.position : 0,
      created_by: typeof input.created_by === 'string' && input.created_by ? input.created_by : 'user',
      created_at: now,
      updated_at: now,
      source: input.source,
      agent_state: input.agent_state,
      agent_name: input.agent_name,
      agent_action_at: input.agent_action_at,
    })
    file.tasks.push(task)
    writeTaskFile({ tasks: file.tasks.map(normalizeTask) })
    return task
  })
}

export function updateTask(taskId: string, updates: UpdateTaskInput): TaskRecord | null {
  return withTasksLock(() => {
    const file = readTaskFile()
    const index = file.tasks.findIndex((task) => task.id === taskId)
    if (index === -1) return null

    const current = normalizeTask(file.tasks[index])
    const next = normalizeTask({
      ...current,
      ...updates,
      id: current.id,
      created_by: current.created_by,
      created_at: current.created_at,
      updated_at: new Date().toISOString(),
      title: typeof updates.title === 'string' ? updates.title : current.title,
    })

    file.tasks[index] = next
    writeTaskFile({ tasks: file.tasks.map(normalizeTask) })
    return next
  })
}

export function moveTask(taskId: string, column: TaskColumn): TaskRecord | null {
  return updateTask(taskId, { column })
}

export function deleteTask(taskId: string): boolean {
  return withTasksLock(() => {
    const file = readTaskFile()
    const nextTasks = file.tasks.filter((task) => task.id !== taskId)
    if (nextTasks.length === file.tasks.length) return false
    writeTaskFile({ tasks: nextTasks.map((task) => normalizeTask(task)) })
    return true
  })
}

export function linkTaskSession(taskId: string, sessionId: string | null): TaskRecord | null {
  return updateTask(taskId, { session_id: sessionId })
}
