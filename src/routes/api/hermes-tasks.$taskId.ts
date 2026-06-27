import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { deleteTask, getTask, moveTask, updateTask } from '../../server/tasks-store'
import { breakdownTaskWithAI, executeTaskBackground, executeTaskWithHermesBackground } from '../../server/astra-tasks'
import { appendLocalMessage, ensureLocalSession, getLocalMessages } from '../../server/local-session-store'
import { getSessionMessages } from '../../server/claude-dashboard-api'
import type { ActivityEntry, ClarificationQuestion, TaskAgentState, TaskColumn, TaskPriority } from '../../server/tasks-store'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isTaskColumn(value: unknown): value is TaskColumn {
  return (
    value === 'backlog' ||
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'review' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'deleted'
  )
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return value === 'high' || value === 'medium' || value === 'low'
}

export const Route = createFileRoute('/api/hermes-tasks/$taskId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        // ?action=log → return latest execution log for the task
        const url = new URL(request.url)
        if (url.searchParams.get('action') === 'log') {
          const hermesHome =
            process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
          const logsDir = path.join(hermesHome, 'logs')
          const prefix = `exec-${params.taskId.slice(0, 8)}-`
          try {
            const files = fs
              .readdirSync(logsDir)
              .filter((f) => f.startsWith(prefix) && f.endsWith('.log'))
              .map((f) => {
                try { return { name: f, mtime: fs.statSync(path.join(logsDir, f)).mtimeMs } }
                catch { return { name: f, mtime: 0 } }
              })
              .sort((a, b) => b.mtime - a.mtime)
            if (files.length === 0) return jsonResponse({ found: false, log: '' })
            const raw = fs.readFileSync(path.join(logsDir, files[0].name), 'utf-8')
            const log = raw.length > 51_200 ? '…(truncated)\n' + raw.slice(-51_200) : raw
            return jsonResponse({ found: true, log, file: files[0].name })
          } catch {
            return jsonResponse({ found: false, log: '' })
          }
        }

        const task = getTask(params.taskId)
        if (!task) return jsonResponse({ error: 'Task not found' }, 404)
        return jsonResponse({ task })
      },

      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          const task = updateTask(params.taskId, {
            title: typeof body.title === 'string' ? body.title : undefined,
            description: typeof body.description === 'string' ? body.description : undefined,
            column: isTaskColumn(body.column) ? body.column : undefined,
            priority: isTaskPriority(body.priority) ? body.priority : undefined,
            assignee: body.assignee === null || typeof body.assignee === 'string' ? body.assignee : undefined,
            tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
            due_date: body.due_date === null || typeof body.due_date === 'string' ? body.due_date : undefined,
            position: typeof body.position === 'number' ? body.position : undefined,
            session_id: body.session_id === null || typeof body.session_id === 'string' ? body.session_id : undefined,
            agent_state: (body.agent_state === null || body.agent_state === 'reviewing' || body.agent_state === 'delegating' || body.agent_state === 'working' || body.agent_state === 'waiting_for_input') ? body.agent_state as TaskAgentState | null : undefined,
            agent_name: body.agent_name === null || typeof body.agent_name === 'string' ? body.agent_name : undefined,
            agent_action_at: body.agent_action_at === null || typeof body.agent_action_at === 'string' ? body.agent_action_at : undefined,
          })

          if (!task) return jsonResponse({ error: 'Task not found' }, 404)
          return jsonResponse({ task })
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400)
        }
      },

      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const deleted = deleteTask(params.taskId)
        if (!deleted) return jsonResponse({ error: 'Task not found' }, 404)
        return jsonResponse({ ok: true })
      },

      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const url = new URL(request.url)
        const action = url.searchParams.get('action') || 'move'

        if (action === 'launch') {
          const task = getTask(params.taskId)
          if (!task) return jsonResponse({ error: 'Task not found' }, 404)

          const sessionId = `task-${task.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`

          // Fetch prior session tail if linked — prefer dashboard API (real history),
          // fall back to local store (only has the initial briefing message).
          let priorContext = ''
          if (task.session_id) {
            let tail: Array<{ role: string; content: string }> = []

            // Try dashboard API first — this has the full conversation history
            try {
              const dashResult = await getSessionMessages(task.session_id)
              if (dashResult.messages.length) {
                tail = dashResult.messages
                  .filter((m) => m.role === 'user' || m.role === 'assistant')
                  .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
                  .slice(-20)
                  .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
              }
            } catch {
              // Dashboard unavailable — fall back to local store
            }

            // Fall back to local store if dashboard had nothing
            if (tail.length === 0) {
              const localMsgs = getLocalMessages(task.session_id)
              tail = localMsgs
                .filter((m) => m.role === 'user' || m.role === 'assistant')
                .slice(-20)
                .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
            }

            if (tail.length > 0) {
              // Truncate individual messages to avoid briefing bloat, but keep meaningful context
              priorContext = `\n\n---\n**Prior session history** (session \`${task.session_id}\`, last ${tail.length} messages):\n${tail.map((m) => `[${m.role.toUpperCase()}] ${m.content.slice(0, 800)}`).join('\n\n')}\n---`
            }
          }

          const hasPrior = Boolean(task.session_id && priorContext)
          const briefing = [
            'You are picking up a task from the Hermes Workspace task board. Here is the full context:',
            '',
            `**Task:** ${task.title}`,
            `**Status:** ${task.column}  |  **Priority:** ${task.priority}  |  **Assignee:** ${task.assignee ?? 'Unassigned'}`,
            `**Tags:** ${task.tags.join(', ') || 'none'}  |  **Due:** ${task.due_date ?? 'none'}`,
            '',
            '**Description:**',
            task.description || '(none)',
            priorContext,
            '',
            hasPrior
              ? 'This task has prior session history (shown above). Review it and give me a concise **current status** — what has been done, what is blocked, and the exact **next action** to move it forward.'
              : 'This is a fresh start on this task. Based on the title and description, give me a concise **current status** (what we know so far) and the exact **next action** to move it forward.',
            '',
            'Be direct and actionable. Start working immediately after your briefing.',
          ].join('\n')

          ensureLocalSession(sessionId)
          appendLocalMessage(sessionId, {
            id: randomUUID(),
            role: 'user',
            content: briefing,
            timestamp: Date.now(),
          })

          return jsonResponse({ sessionId, briefing, task: getTask(params.taskId) })
        }

        if (action === 'comment') {
          try {
            const body = (await request.json()) as Record<string, unknown>
            const text = typeof body.text === 'string' ? body.text.trim() : ''
            if (!text) return jsonResponse({ error: 'text is required' }, 400)
            const task = getTask(params.taskId)
            if (!task) return jsonResponse({ error: 'Task not found' }, 404)
            const now = new Date().toISOString()
            const entry: ActivityEntry = { id: randomUUID(), by: 'user', byEmoji: '👤', action: 'replied', note: text, at: now }
            const existing = task.agent_history ?? []
            // Re-trigger agent when: waiting for input, OR agent has previously worked on this task
            const hasAgentHistory = existing.some(e => e.by !== 'user' && e.action !== 'executed')
            const shouldResume = task.agent_state === 'waiting_for_input' || (hasAgentHistory && task.agent_state !== 'working')
            // Use the full hermes execution engine when a prior hermes run exists (i.e. the
            // task was previously executed, not just analysed). Conversational-only tasks that
            // have never been executed still get the lighter directChat path.
            const hadExecution = existing.some(e =>
              e.by !== 'user' && ['attempted', 'completed', 'blocked'].includes(e.action)
            )
            // Re-open: if user replies on a completed (review) or blocked task, move it back
            // to in_progress so the board reflects that work is resuming.
            const reopenColumn =
              task.column === 'blocked' || task.column === 'review' ? 'in_progress' : task.column
            updateTask(params.taskId, {
              agent_history: [...existing, entry],
              ...(shouldResume ? {
                agent_state: 'working',
                agent_name: task.agent_name ?? 'astra',
                agent_action_at: now,
                waiting_for_user: false,
                column: reopenColumn,
              } : {}),
            })
            if (shouldResume) {
              if (hadExecution) {
                executeTaskWithHermesBackground(params.taskId)
              } else {
                executeTaskBackground(params.taskId)
              }
            }
            return jsonResponse({ ok: true, resumed: shouldResume })
          } catch {
            return jsonResponse({ error: 'Invalid request body' }, 400)
          }
        }

        if (action === 'clarify') {
          try {
            const body = (await request.json()) as Record<string, unknown>
            const answers = (body.answers ?? {}) as Record<string, string>
            const task = getTask(params.taskId)
            if (!task) return jsonResponse({ error: 'Task not found' }, 404)

            const questions: Array<ClarificationQuestion> = task.clarification_questions ?? []
            const now = new Date().toISOString()

            // Save answers back into the questions array
            const updatedQuestions = questions.map(q => ({
              ...q,
              answer: answers[q.id] != null ? String(answers[q.id]) : q.answer,
              answered_at: answers[q.id] != null ? now : q.answered_at,
            }))

            // Build one combined Q&A history entry so the resumed agent sees context
            const qaNote = updatedQuestions
              .map((q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${answers[q.id] ?? q.answer ?? '(no answer)'}`)
              .join('\n\n')

            const replyEntry: ActivityEntry = {
              id: randomUUID(),
              by: 'user',
              byEmoji: '👤',
              action: 'replied',
              note: qaNote,
              at: now,
            }

            const existing = task.agent_history ?? []
            const hadExecution = existing.some(e =>
              e.by !== 'user' && ['attempted', 'completed', 'blocked'].includes(e.action),
            )
            const reopenColumn =
              task.column === 'blocked' || task.column === 'review' ? 'in_progress' : task.column

            updateTask(params.taskId, {
              clarification_questions: updatedQuestions,
              agent_history: [...existing, replyEntry],
              agent_state: 'working',
              agent_name: task.agent_name ?? 'astra',
              agent_action_at: now,
              waiting_for_user: false,
              column: reopenColumn,
            })

            if (hadExecution) {
              executeTaskWithHermesBackground(params.taskId)
            } else {
              executeTaskBackground(params.taskId)
            }

            return jsonResponse({ ok: true, resumed: true })
          } catch {
            return jsonResponse({ error: 'Invalid request body' }, 400)
          }
        }

        if (action === 'breakdown') {
          const task = getTask(params.taskId)
          if (!task) return jsonResponse({ error: 'Task not found' }, 404)
          const result = await breakdownTaskWithAI(params.taskId)
          if (!result) return jsonResponse({ ok: false, error: 'AI could not generate subtasks' }, 422)
          const bdExisting = task.agent_history ?? []
          updateTask(params.taskId, {
            agent_history: [...bdExisting, {
              id: randomUUID(), by: 'user', byEmoji: '🔀', action: 'breakdown',
              note: `Created ${result.count} subtask${result.count !== 1 ? 's' : ''}: ${result.titles.slice(0, 3).join(', ')}${result.count > 3 ? '…' : ''}`,
              at: new Date().toISOString(),
            }],
          })
          return jsonResponse({ ok: true, count: result.count, titles: result.titles })
        }

        if (action === 'execute') {
          const task = getTask(params.taskId)
          if (!task) return jsonResponse({ error: 'Task not found' }, 404)
          if (task.agent_state === 'working') return jsonResponse({ ok: true, alreadyRunning: true })
          const exExisting = task.agent_history ?? []
          const now = new Date().toISOString()
          // Move to in_progress atomically — guards against duplicate clicks and sets
          // agent_state before the background fn starts, so a second request sees 'working'.
          const targetColumn = (task.column === 'backlog' || task.column === 'todo') ? 'in_progress' : task.column
          updateTask(params.taskId, {
            column: targetColumn,
            agent_state: 'working',
            agent_name: 'astra',
            agent_action_at: now,
            waiting_for_user: false,
            agent_history: [...exExisting, {
              id: randomUUID(), by: 'user', byEmoji: '👤', action: 'executed',
              note: 'Sent task to agent for execution.',
              at: now,
            }],
          })
          executeTaskWithHermesBackground(params.taskId)
          return jsonResponse({ ok: true })
        }

        if (action !== 'move') {
          return jsonResponse({ error: `Unsupported action: ${action}` }, 400)
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          if (typeof body.column !== 'string') {
            return jsonResponse({ error: 'column is required' }, 400)
          }
          const task = moveTask(params.taskId, body.column as TaskColumn)
          if (!task) return jsonResponse({ error: 'Task not found' }, 404)
          return jsonResponse({ task })
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400)
        }
      },
    },
  },
})
