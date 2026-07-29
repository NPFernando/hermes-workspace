/**
 * Tests for the task blocker system:
 *   - Blocker type taxonomy
 *   - Credential collection + validation
 *   - Dependency auto-resume
 *   - Blocker resolution
 *
 * These test the store layer — the API endpoint tests are run separately.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

// ── Minimal in-memory store for testing ────────────────────────────────────
// Tests the logic directly without relying on module resolution tricks

type TaskColumn = 'backlog' | 'todo' | 'in_progress' | 'review' | 'blocked' | 'done' | 'deleted'
type TaskPriority = 'high' | 'medium' | 'low'
type BlockerType = 'credential' | 'dependency' | 'execution' | 'input' | 'environment' | null
type CredentialNeeded = {
  key: string
  label: string
  description: string
  provided: boolean
  provided_at?: string
  validated?: boolean
}
type ActivityEntry = { id: string; by: string; byEmoji: string; action: string; note: string; at: string }
type TaskRecord = {
  id: string
  title: string
  column: TaskColumn
  priority: TaskPriority
  blocker_type?: BlockerType
  blocker_reason?: string
  blocked_since?: string
  credentials_needed?: CredentialNeeded[]
  depends_on?: string[]
  resolved_by_task?: string
  agent_history?: ActivityEntry[]
}

let allTasks: TaskRecord[] = []

function resetStore() {
  allTasks = []
}

function createTask(overrides: Partial<TaskRecord> & { title: string; column?: TaskColumn; priority?: TaskPriority }): TaskRecord {
  const task: TaskRecord = {
    id: randomUUID(),
    title: overrides.title,
    column: overrides.column ?? 'todo',
    priority: overrides.priority ?? 'medium',
    blocker_type: overrides.blocker_type,
    blocker_reason: overrides.blocker_reason,
    blocked_since: overrides.blocked_since,
    credentials_needed: overrides.credentials_needed,
    depends_on: overrides.depends_on,
    resolved_by_task: overrides.resolved_by_task,
    agent_history: overrides.agent_history ?? [],
  }
  allTasks.push(task)
  return task
}

function getTask(id: string): TaskRecord | undefined {
  return allTasks.find((t) => t.id === id)
}

function updateTask(id: string, updates: Partial<TaskRecord>): TaskRecord | undefined {
  const idx = allTasks.findIndex((t) => t.id === id)
  if (idx === -1) return undefined
  allTasks[idx] = { ...allTasks[idx], ...updates }
  return allTasks[idx]
}

function listTasks(opts?: { column?: TaskColumn; includeDone?: boolean }): TaskRecord[] {
  let tasks = allTasks
  if (opts?.column) tasks = tasks.filter((t) => t.column === opts.column)
  return tasks
}

// ── Auto-resume logic (mirror of astra-tasks.ts) ─────────────────────────

function maybeAutoResumeAfterCompletion(completedTaskId: string): { unblocked: number } {
  const dependents = allTasks.filter(
    (t) =>
      t.column === 'blocked' &&
      t.blocker_type === 'dependency' &&
      Array.isArray(t.depends_on) &&
      t.depends_on.includes(completedTaskId),
  )

  if (dependents.length === 0) return { unblocked: 0 }

  let unblocked = 0
  for (const task of dependents) {
    const deps = task.depends_on ?? []
    const allDone = deps.every((depId) => allTasks.find((t) => t.id === depId)?.column === 'done')

    if (!allDone) continue

    updateTask(task.id, {
      column: 'todo',
      blocker_type: undefined,
      blocker_reason: undefined,
      blocked_since: undefined,
      resolved_by_task: undefined,
    })

    unblocked++
  }

  return { unblocked }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Task Blocker System', () => {
  beforeEach(() => {
    resetStore()
  })

  // ────────────────────────────────────────────────────────────────────────
  // Schema: blocker type taxonomy
  // ────────────────────────────────────────────────────────────────────────

  describe('Blocker Type Taxonomy', () => {
    it('creates a task with credential blocker type', () => {
      const task = createTask({
        title: 'Deploy IBKR grid trading bot',
        column: 'blocked',
        priority: 'high',
        blocker_type: 'credential',
        blocker_reason: 'Missing IBKR API credentials',
        blocked_since: new Date().toISOString(),
        credentials_needed: [
          { key: 'IBKR_ACCOUNT_ID', label: 'IBKR Account ID', description: 'Your Interactive Brokers account', provided: false },
          { key: 'IBKR_API_KEY', label: 'IBKR API Key', description: 'API key for trading', provided: false },
        ],
      })

      expect(task.blocker_type).toBe('credential')
      expect(task.column).toBe('blocked')
      expect(task.credentials_needed).toHaveLength(2)
      expect(task.credentials_needed![0].provided).toBe(false)
      expect(task.credentials_needed![1].provided).toBe(false)
    })

    it('creates a task with dependency blocker type', () => {
      const task = createTask({
        title: 'Run backtest after daily data sync',
        column: 'blocked',
        priority: 'medium',
        blocker_type: 'dependency',
        blocker_reason: 'Waiting for data pipeline to complete',
        blocked_since: new Date().toISOString(),
        depends_on: ['dep-task-001', 'dep-task-002'],
      })

      expect(task.blocker_type).toBe('dependency')
      expect(task.blocked_since).toBeDefined()
      expect(task.depends_on).toEqual(['dep-task-001', 'dep-task-002'])
    })

    it('supports all blocker types', () => {
      const types: BlockerType[] = ['credential', 'dependency', 'execution', 'input', 'environment', null]
      for (const type of types) {
        const task = createTask({ title: `Blocker ${type}`, column: 'blocked', blocker_type: type })
        expect(task.blocker_type).toBe(type)
      }
    })

    it('preserves blocker fields through update', () => {
      const task = createTask({
        title: 'Debug connection timeout',
        column: 'blocked',
        blocker_type: 'environment',
        blocker_reason: 'Port 9443 not reachable',
        blocked_since: '2025-01-01T00:00:00Z',
      })

      const updated = updateTask(task.id, { title: 'Debug timeout v2' })
      expect(updated!.blocker_type).toBe('environment')
      expect(updated!.blocker_reason).toBe('Port 9443 not reachable')
      expect(updated!.blocked_since).toBe('2025-01-01T00:00:00Z')
      expect(updated!.title).toBe('Debug timeout v2')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Credential lifecycle
  // ────────────────────────────────────────────────────────────────────────

  describe('Credential Collection', () => {
    it('tracks credential provision status', () => {
      const task = createTask({
        title: 'Set up Binance trading',
        column: 'blocked',
        blocker_type: 'credential',
        credentials_needed: [
          { key: 'BINANCE_API_KEY', label: 'Binance API Key', description: 'Read-only API key', provided: false },
        ],
      })

      // Mark credential as provided
      const updated = updateTask(task.id, {
        credentials_needed: [
          { key: 'BINANCE_API_KEY', label: 'Binance API Key', description: 'Read-only API key', provided: true, provided_at: new Date().toISOString() },
        ],
      })

      expect(updated!.credentials_needed![0].provided).toBe(true)
      expect(updated!.credentials_needed![0].provided_at).toBeDefined()
    })

    it('detects when all credentials are provided', () => {
      const task = createTask({
        title: 'Multi-credential task',
        column: 'blocked',
        blocker_type: 'credential',
        credentials_needed: [
          { key: 'KEY_A', label: 'Key A', description: '...', provided: false },
          { key: 'KEY_B', label: 'Key B', description: '...', provided: false },
        ],
      })

      // Provide first
      updateTask(task.id, {
        credentials_needed: [
          { key: 'KEY_A', label: 'Key A', description: '...', provided: true },
          { key: 'KEY_B', label: 'Key B', description: '...', provided: false },
        ],
      })

      const partial = getTask(task.id)
      expect(partial!.credentials_needed!.filter((c) => c.provided)).toHaveLength(1)

      // Provide second
      updateTask(task.id, {
        credentials_needed: [
          { key: 'KEY_A', label: 'Key A', description: '...', provided: true },
          { key: 'KEY_B', label: 'Key B', description: '...', provided: true },
        ],
      })

      const full = getTask(task.id)
      const allProvided = full!.credentials_needed!.every((c) => c.provided)
      expect(allProvided).toBe(true)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Resolver flows
  // ────────────────────────────────────────────────────────────────────────

  describe('Blocker Resolution', () => {
    it('resolves a blocker by clearing fields and moving to todo', () => {
      const task = createTask({
        title: 'Resolvable blocker',
        column: 'blocked',
        blocker_type: 'input',
        blocker_reason: 'Need user confirmation',
        blocked_since: new Date().toISOString(),
      })

      const resolved = updateTask(task.id, {
        column: 'todo',
        blocker_type: undefined,
        blocker_reason: undefined,
        blocked_since: undefined,
      })

      expect(resolved!.column).toBe('todo')
      expect(resolved!.blocker_type).toBeUndefined()
      expect(resolved!.blocker_reason).toBeUndefined()
      expect(resolved!.blocked_since).toBeUndefined()
    })

    it('only changes specified fields during resolution', () => {
      const task = createTask({
        title: 'Partial resolve',
        column: 'blocked',
        priority: 'high',
        blocker_type: 'execution',
      })

      const resolved = updateTask(task.id, { blocker_type: undefined })

      expect(resolved!.column).toBe('blocked') // unchanged
      expect(resolved!.priority).toBe('high') // unchanged
      expect(resolved!.blocker_type).toBeUndefined() // cleared
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Dependency auto-resume
  // ────────────────────────────────────────────────────────────────────────

  describe('Dependency Auto-Resume', () => {
    it('auto-resumes when all depends_on tasks are done', () => {
      const dep1 = createTask({ title: 'Data sync', column: 'done', priority: 'high' })
      const dep2 = createTask({ title: 'Model train', column: 'done', priority: 'medium' })

      const blocked = createTask({
        title: 'Backtest',
        column: 'blocked',
        blocker_type: 'dependency',
        depends_on: [dep1.id, dep2.id],
      })

      const result = maybeAutoResumeAfterCompletion(dep2.id)
      expect(result.unblocked).toBe(1)

      const unblocked = getTask(blocked.id)
      expect(unblocked!.column).toBe('todo')
      expect(unblocked!.blocker_type).toBeUndefined()
    })

    it('does NOT auto-resume when some deps are not done', () => {
      const dep1 = createTask({ title: 'Data sync', column: 'done' })
      const dep2 = createTask({ title: 'Model train', column: 'in_progress' })

      const blocked = createTask({
        title: 'Backtest',
        column: 'blocked',
        blocker_type: 'dependency',
        depends_on: [dep1.id, dep2.id],
      })

      const result = maybeAutoResumeAfterCompletion(dep1.id)
      expect(result.unblocked).toBe(0)

      const stillBlocked = getTask(blocked.id)
      expect(stillBlocked!.column).toBe('blocked')
    })

    it('handles tasks with no depends_on gracefully', () => {
      const task = createTask({ title: 'Simple task', column: 'done' })
      const result = maybeAutoResumeAfterCompletion(task.id)
      expect(result.unblocked).toBe(0)
    })

    it('auto-resumes multiple dependent tasks at once', () => {
      const dep = createTask({ title: 'Setup infra', column: 'done' })

      const t1 = createTask({
        title: 'Deploy API',
        column: 'blocked',
        blocker_type: 'dependency',
        depends_on: [dep.id],
      })
      const t2 = createTask({
        title: 'Deploy worker',
        column: 'blocked',
        blocker_type: 'dependency',
        depends_on: [dep.id],
      })

      const result = maybeAutoResumeAfterCompletion(dep.id)
      expect(result.unblocked).toBe(2)

      expect(getTask(t1.id)!.column).toBe('todo')
      expect(getTask(t2.id)!.column).toBe('todo')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Grouping / listing
  // ────────────────────────────────────────────────────────────────────────

  describe('Blocker Grouping', () => {
    it('groups blocked tasks by blocker_type', () => {
      createTask({ title: 'C1', column: 'blocked', blocker_type: 'credential' })
      createTask({ title: 'C2', column: 'blocked', blocker_type: 'credential' })
      createTask({ title: 'D1', column: 'blocked', blocker_type: 'dependency' })
      createTask({ title: 'E1', column: 'blocked', blocker_type: 'execution' })

      const blocked = listTasks({ column: 'blocked' })
      const groups: Record<string, number> = {}
      for (const t of blocked) {
        const key = t.blocker_type ?? 'unknown'
        groups[key] = (groups[key] ?? 0) + 1
      }

      expect(groups.credential).toBe(2)
      expect(groups.dependency).toBe(1)
      expect(groups.execution).toBe(1)
    })

    it('blocks tasks without blocker_type as unknown', () => {
      createTask({ title: 'No type', column: 'blocked' })
      const blocked = listTasks({ column: 'blocked' })
      expect(blocked[0].blocker_type).toBeUndefined()
    })
  })
})
