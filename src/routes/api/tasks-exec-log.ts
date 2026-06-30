import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// GET /api/tasks-exec-log?task_id=<id>&lines=<n>
//
// Returns the tail of the most recent hermes -z execution log for a task.
// Logs live at ~/.hermes/logs/exec-{task_id_prefix}-{timestamp}.log
// ---------------------------------------------------------------------------

const HERMES_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const LOGS_DIR    = path.join(HERMES_HOME, 'logs')

function findLatestLog(taskId: string): string | null {
  const prefix = `exec-${taskId.slice(0, 8)}-`
  try {
    const files = fs.readdirSync(LOGS_DIR)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.log'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(LOGS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    return files[0] ? path.join(LOGS_DIR, files[0].name) : null
  } catch {
    return null
  }
}

function tailLines(filePath: string, n: number): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    return lines.slice(-n).join('\n')
  } catch {
    return ''
  }
}

export const Route = createFileRoute('/api/tasks-exec-log')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const taskId = url.searchParams.get('task_id')?.trim()
        const lines  = Math.min(parseInt(url.searchParams.get('lines') ?? '40', 10), 200)

        if (!taskId) {
          return json({ ok: false, error: 'task_id is required' }, { status: 400 })
        }

        const logFile = findLatestLog(taskId)
        if (!logFile) {
          return json({ ok: true, log: '', found: false })
        }

        const stat = fs.statSync(logFile)
        const log  = tailLines(logFile, lines)
        return json({
          ok: true,
          found: true,
          log,
          file: path.basename(logFile),
          size_bytes: stat.size,
          modified_at: stat.mtime.toISOString(),
        })
      },
    },
  },
})
