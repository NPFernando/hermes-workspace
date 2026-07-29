/**
 * GET /api/workspace/stats
 *
 * Returns lightweight workspace statistics: open task count, disk usage,
 * active sessions. Used by the chat sidebar header card.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

function getDiskUsagePercent(): number | null {
  try {
    const out = execSync("df / --output=pcent | tail -1", { timeout: 2000 }).toString().trim()
    return parseInt(out.replace('%', ''), 10)
  } catch {
    return null
  }
}

function getOpenTaskCount(): number {
  try {
    const hermesHome = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
    const tasksPath = path.join(hermesHome, 'tasks.json')
    if (!fs.existsSync(tasksPath)) return 0
    const data = JSON.parse(fs.readFileSync(tasksPath, 'utf-8')) as { tasks?: Array<{ column?: string }> }
    const tasks = Array.isArray(data.tasks) ? data.tasks : []
    return tasks.filter((t) => t.column !== 'done' && t.column !== 'deleted').length
  } catch {
    return 0
  }
}

export const Route = createFileRoute('/api/workspace/stats')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const diskPct = getDiskUsagePercent()
        const openTasks = getOpenTaskCount()

        return json({
          ok: true,
          diskUsagePercent: diskPct,
          openTaskCount: openTasks,
          memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        })
      },
    },
  },
})
