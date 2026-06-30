import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { listTasks } from '../../server/tasks-store'

export type SweepStats = {
  lastSweepAt: string
  executedToday: number
  executedDate: string
  completedToday: number
  blockedToday: number
  needsInputToday: number
  outcomeDate: string
}

export const Route = createFileRoute('/api/tasks-sweep-stats')({
  server: {
    handlers: {
      GET: () => {
        const todayDate = new Date().toISOString().slice(0, 10)

        let dispatched = 0, completed = 0, blockedOutcome = 0, needsInput = 0
        let lastSweepAt: string | null = null
        try {
          const statsFile = path.join(
            process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes'),
            'sweep-stats.json',
          )
          const stats = JSON.parse(fs.readFileSync(statsFile, 'utf-8')) as SweepStats
          dispatched    = stats.executedDate === todayDate ? (stats.executedToday ?? 0) : 0
          completed     = stats.outcomeDate  === todayDate ? (stats.completedToday ?? 0) : 0
          blockedOutcome= stats.outcomeDate  === todayDate ? (stats.blockedToday ?? 0) : 0
          needsInput    = stats.outcomeDate  === todayDate ? (stats.needsInputToday ?? 0) : 0
          lastSweepAt   = stats.lastSweepAt ?? null
        } catch { /* no stats yet */ }

        // Count timed-out events from task history today
        let timedOutToday = 0
        try {
          const all = listTasks({ includeDone: false })
          all.forEach((t) => {
            (t.agent_history ?? []).forEach((h: { action: string; at?: string }) => {
              if (h.action === 'timed_out' && (h.at ?? '').startsWith(todayDate)) timedOutToday++
            })
          })
        } catch { /* non-fatal */ }

        const total = completed + blockedOutcome + needsInput + timedOutToday
        const successRate = total > 0 ? Math.round((completed / total) * 100) : null

        return json({ ok: true, dispatched, completed, blocked: blockedOutcome, needsInput, timedOutToday, lastSweepAt, successRate })
      },
    },
  },
})
