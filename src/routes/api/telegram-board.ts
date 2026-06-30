import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { listTasks } from '../../server/tasks-store'

// ---------------------------------------------------------------------------
// POST /api/telegram-board
//
// Sends an on-demand board status summary to Telegram.
// Called by the /board hermes skill or directly via curl.
// Body (all optional): { chat_id?: string }
// ---------------------------------------------------------------------------

const HERMES_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const HERMES_BIN  = path.join(HERMES_HOME, 'node_modules/.bin/hermes')
const DEFAULT_TG  = 'telegram:2130622225'

function buildBoardMessage(): string {
  const all = listTasks({ includeDone: true })
  const cols: Record<string, number> = {}
  all.forEach((t) => { cols[t.column] = (cols[t.column] ?? 0) + 1 })

  const reviewReady = all.filter((t) => {
    if (t.column !== 'review' || t.agent_state) return false
    const plannedHistory = (t.agent_history ?? []).filter((h) => h.action === 'planned')
    if (plannedHistory.length === 0) return false
    const lastNote = plannedHistory[plannedHistory.length - 1].note ?? ''
    return !lastNote.includes('Plan unavailable') && lastNote.length >= 80
  }).length

  const depWaiting = all.filter(
    (t) => t.column === 'todo' && Array.isArray(t.depends_on) && t.depends_on.length > 0,
  ).length

  const working  = all.filter((t) => t.agent_state === 'working').length
  const blocked  = cols['blocked'] ?? 0
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
  const doneToday = all.filter(
    (t) => t.column === 'done' && new Date(t.updated_at).getTime() >= oneDayAgo,
  ).length

  const now = new Date()
  const istMs = now.getTime() + (5 * 60 + 30) * 60 * 1000
  const istStr = new Date(istMs).toISOString().replace('T', ' ').slice(0, 16) + ' IST'

  const sisterLoad: Record<string, number> = {}
  all.filter((t) => t.column !== 'done' && t.column !== 'deleted' && t.assignee)
    .forEach((t) => { sisterLoad[t.assignee!] = (sisterLoad[t.assignee!] ?? 0) + 1 })
  const sisterLine = Object.entries(sisterLoad)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([name, count]) => `${name}:${count}`).join(' · ')

  // Read sweep stats for pipeline health
  let executedToday = 0
  let lastSweepLine = ''
  try {
    const stats = JSON.parse(fs.readFileSync(path.join(HERMES_HOME, 'sweep-stats.json'), 'utf-8')) as {
      lastSweepAt?: string; executedToday?: number; executedDate?: string
    }
    const todayDate = new Date().toISOString().slice(0, 10)
    if (stats.executedDate === todayDate) executedToday = stats.executedToday ?? 0
    if (stats.lastSweepAt) {
      const agoMin = Math.round((Date.now() - new Date(stats.lastSweepAt).getTime()) / 60_000)
      lastSweepLine = agoMin < 120 ? `${agoMin}m ago` : `${Math.round(agoMin / 60)}h ago`
    }
  } catch { /* no stats yet */ }

  const lines: Array<string> = [
    `📋 Board status — ${istStr}`,
    `Todo: ${cols['todo'] ?? 0} | Review: ${cols['review'] ?? 0} | Done today: ${doneToday}`,
    `▶️  Running: ${working} | ✅ Ready: ${reviewReady} | 🚫 Blocked: ${blocked}`,
    `🔄 Executed today: ${executedToday}${lastSweepLine ? ` | Last sweep: ${lastSweepLine}` : ''}`,
  ]
  if (sisterLine)     lines.push(`👥 ${sisterLine}`)
  if (depWaiting > 0) lines.push(`⏳ Waiting on credentials: ${depWaiting}`)
  if (blocked > 0)    lines.push(`⚠️  ${blocked} task(s) blocked — check agent.fernandofamily.com/tasks`)
  lines.push('→ agent.fernandofamily.com/tasks')

  return lines.join('\n')
}

export const Route = createFileRoute('/api/telegram-board')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { chat_id?: string } = {}
        try { body = (await request.json()) as typeof body } catch { /* empty body ok */ }

        const target = body.chat_id ? `telegram:${body.chat_id}` : DEFAULT_TG
        const msg = buildBoardMessage()

        const r = spawnSync(HERMES_BIN, ['send', '--to', target, '-q', msg], {
          encoding: 'utf-8',
          timeout: 15_000,
        })

        if (r.status !== 0) {
          return json({ ok: false, error: 'hermes send failed', stderr: r.stderr.slice(0, 200) }, { status: 500 })
        }

        return json({ ok: true, message: msg })
      },

      // GET: just return the formatted message (useful for debugging)
      GET: () => {
        const msg = buildBoardMessage()
        return json({ ok: true, message: msg })
      },
    },
  },
})
