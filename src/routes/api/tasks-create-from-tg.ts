import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { generateTaskFromText } from '../../server/astra-tasks'
import { createTask } from '../../server/tasks-store'

// ---------------------------------------------------------------------------
// POST /api/tasks-create-from-tg
//
// Creates a task from a natural-language description and confirms via Telegram.
// Called by the /todo hermes skill.
// Body: { text: string; chat_id?: string; priority?: string; assignee?: string }
// ---------------------------------------------------------------------------

const HERMES_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const HERMES_BIN  = path.join(HERMES_HOME, 'node_modules/.bin/hermes')
const DEFAULT_TG  = 'telegram:2130622225'

export const Route = createFileRoute('/api/tasks-create-from-tg')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { text?: string; chat_id?: string; priority?: string; assignee?: string } = {}
        try { body = (await request.json()) as typeof body } catch { /* empty body */ }

        const text = body.text?.trim()
        if (!text) {
          return json({ ok: false, error: 'text is required' }, { status: 400 })
        }

        // Use AI to parse natural language into a structured task
        let suggestion: Awaited<ReturnType<typeof generateTaskFromText>>
        try {
          suggestion = await generateTaskFromText(text)
        } catch {
          return json({ ok: false, error: 'AI task parsing failed' }, { status: 500 })
        }

        if (!suggestion) {
          return json({ ok: false, error: 'Could not parse task from text' }, { status: 422 })
        }

        // Override with explicit fields if provided
        if (body.priority && ['high', 'medium', 'low'].includes(body.priority)) {
          suggestion.priority = body.priority as 'high' | 'medium' | 'low'
        }
        if (body.assignee) suggestion.assignee = body.assignee

        const task = createTask({
          ...suggestion,
          column: 'todo',
          created_by: 'telegram',
          source: 'human',
        } as Parameters<typeof createTask>[0])

        // Send confirmation to Telegram
        const target = body.chat_id ? `telegram:${body.chat_id}` : DEFAULT_TG
        const priorityEmoji = task.priority === 'high' ? '🔴' : task.priority === 'low' ? '🟢' : '🟡'
        const msg = `✅ Task created\n${priorityEmoji} ${task.title}\n${task.description ? task.description.slice(0, 120) + (task.description.length > 120 ? '…' : '') : ''}\n→ agent.fernandofamily.com/tasks?task=${task.id}`

        spawnSync(HERMES_BIN, ['send', '--to', target, '-q', msg], {
          encoding: 'utf-8',
          timeout: 15_000,
        })

        return json({ ok: true, task: { id: task.id, title: task.title, priority: task.priority, column: task.column } })
      },
    },
  },
})
