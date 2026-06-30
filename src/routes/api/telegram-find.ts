import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { listTasks } from '../../server/tasks-store'

// ---------------------------------------------------------------------------
// POST /api/telegram-find
//
// Searches tasks by keyword and sends results to Telegram.
// Called by the /find hermes skill or directly via curl.
// Body: { keyword: string; chat_id?: string; limit?: number }
// ---------------------------------------------------------------------------

const HERMES_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const HERMES_BIN  = path.join(HERMES_HOME, 'node_modules/.bin/hermes')
const DEFAULT_TG  = 'telegram:2130622225'

const COLUMN_EMOJI: Record<string, string> = {
  backlog: '📥', todo: '📋', in_progress: '⚙️', review: '🔍', blocked: '🚫', done: '✅',
}

export const Route = createFileRoute('/api/telegram-find')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { keyword?: string; chat_id?: string; limit?: number } = {}
        try { body = (await request.json()) as typeof body } catch { /* empty body */ }

        const keyword = body.keyword?.trim().toLowerCase()
        if (!keyword) {
          return json({ ok: false, error: 'keyword is required' }, { status: 400 })
        }

        const limit = Math.min(body.limit ?? 8, 15)
        const all = listTasks({ includeDone: false })

        const matches = all.filter((t) => {
          const haystack = `${t.title} ${t.description ?? ''} ${(t.tags ?? []).join(' ')}`.toLowerCase()
          return haystack.includes(keyword)
        }).slice(0, limit)

        const target = body.chat_id ? `telegram:${body.chat_id}` : DEFAULT_TG

        let msg: string
        if (matches.length === 0) {
          msg = `🔎 No tasks matching "${keyword}"`
        } else {
          const lines = [`🔎 Tasks matching "${keyword}" (${matches.length}${matches.length === limit ? '+' : ''})`]
          for (const t of matches) {
            const emoji = COLUMN_EMOJI[t.column] ?? '•'
            const agent = t.agent_state ? ` [${t.agent_state}]` : ''
            const assignee = t.assignee ? ` @${t.assignee}` : ''
            lines.push(`${emoji} ${t.title.slice(0, 60)}${agent}${assignee}`)
          }
          msg = lines.join('\n')
        }

        const r = spawnSync(HERMES_BIN, ['send', '--to', target, '-q', msg], {
          encoding: 'utf-8',
          timeout: 15_000,
        })

        if (r.status !== 0) {
          return json({ ok: false, error: 'hermes send failed', stderr: r.stderr?.slice(0, 200) }, { status: 500 })
        }

        return json({ ok: true, count: matches.length, message: msg })
      },

      // GET with ?q= for quick curl testing
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const keyword = url.searchParams.get('q')?.toLowerCase() ?? ''
        if (!keyword) return json({ ok: false, error: 'q param required' }, { status: 400 })
        const all = listTasks({ includeDone: false })
        const matches = all.filter((t) =>
          `${t.title} ${t.description ?? ''}`.toLowerCase().includes(keyword)
        ).slice(0, 10).map((t) => ({ id: t.id, title: t.title, column: t.column, assignee: t.assignee }))
        return json({ ok: true, count: matches.length, matches })
      },
    },
  },
})
