import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

let tempHome: string | undefined
const previousHermesHome = process.env.HERMES_HOME

afterEach(() => {
  vi.resetModules()
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true })
  tempHome = undefined
  if (previousHermesHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previousHermesHome
})

describe('tasks-store active title deduplication', () => {
  it('reuses an active task but permits a new task after completion', async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-task-store-'))
    process.env.HERMES_HOME = tempHome
    vi.resetModules()

    const { createTask, listTasks } = await import('./tasks-store')
    const first = createTask({
      title: '  Review   monthly report ',
      column: 'backlog',
    })
    const duplicate = createTask({
      title: 'review monthly    report',
      column: 'todo',
    })

    expect(duplicate.id).toBe(first.id)
    expect(duplicate.column).toBe('backlog')
    expect(listTasks({ includeDone: true })).toHaveLength(1)

    const completed = createTask({
      title: 'Archive monthly report',
      column: 'done',
    })
    const replacement = createTask({
      title: 'ARCHIVE MONTHLY REPORT',
      column: 'backlog',
    })
    expect(replacement.id).not.toBe(completed.id)
    expect(listTasks({ includeDone: true })).toHaveLength(3)
  })
})
