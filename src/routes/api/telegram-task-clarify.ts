import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { executeTaskBackground, executeTaskWithHermesBackground } from '../../server/astra-tasks'
import { listTasks, updateTask } from '../../server/tasks-store'
import { editTelegramClarification } from '../../server/telegram-clarify'
import type { ActivityEntry, ClarificationQuestion, TaskColumn } from '../../server/tasks-store'

// ---------------------------------------------------------------------------
// POST /api/telegram-task-clarify
//
// Four modes, distinguished by which fields are in the body:
//
// A) Inline keyboard option click (from gateway callback_query task: handler):
//    Body: { task_id_prefix, q_index, opt_index }
//    Saves the selected option. When all answered → shows confirm state (NOT auto-resume).
//
// B) Freeform text reply (from gateway text handler):
//    Body: { reply_to_message_id, answer_text }
//    Finds task by message_id, saves answer to first pending freeform question.
//    Returns { handled: true } if a match was found.
//
// C) Confirm resume (from gateway tconf: callback_query handler):
//    Body: { task_id_prefix, confirm: true }
//    Calls finalizeAndResume and edits message to 'done' state.
//
// D) Clear answer for editing (from gateway tedit: callback_query handler):
//    Body: { task_id_prefix, clear_q_index: number }
//    Clears the saved answer for that question and re-renders message as 'pending'.
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Shared: build Q&A note, update task state, resume agent
function finalizeAndResume(
  taskId: string,
  questions: Array<ClarificationQuestion>,
  existingHistory: Array<ActivityEntry>,
  currentColumn: TaskColumn,
  currentAgentName: string | null | undefined,
): void {
  const now = new Date().toISOString()
  const qaNote = questions
    .map((q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${q.answer ?? '(no answer)'}`)
    .join('\n\n')

  const replyEntry: ActivityEntry = {
    id: randomUUID(),
    by: 'user',
    byEmoji: '👤',
    action: 'replied',
    note: qaNote,
    at: now,
  }

  const hadExecution = existingHistory.some(
    (e) => e.by !== 'user' && ['attempted', 'completed', 'blocked'].includes(e.action),
  )
  const reopenColumn = currentColumn === 'blocked' || currentColumn === 'review' ? 'in_progress' : currentColumn

  updateTask(taskId, {
    clarification_questions: questions,
    agent_history: [...existingHistory, replyEntry],
    agent_state: 'working',
    agent_name: currentAgentName ?? 'astra',
    agent_action_at: now,
    waiting_for_user: false,
    column: reopenColumn,
  })

  if (hadExecution) {
    executeTaskWithHermesBackground(taskId)
  } else {
    executeTaskBackground(taskId)
  }
}

export const Route = createFileRoute('/api/telegram-task-clarify')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return jsonResponse({ error: 'invalid json' }, 400)
        }

        // ── Mode D: clear a saved answer so the user can re-answer it ───────
        if (body.clear_q_index != null && typeof body.task_id_prefix === 'string') {
          const clearIdx = Number(body.clear_q_index)
          const prefix = body.task_id_prefix

          if (isNaN(clearIdx) || !prefix) {
            return jsonResponse({ error: 'invalid fields' }, 400)
          }

          const allTasksD = listTasks({ includeDone: false })
          const taskD = allTasksD.find((t) => t.id.replace(/-/g, '').slice(0, 12) === prefix)
          if (!taskD) return jsonResponse({ error: 'task not found' }, 404)
          if (!taskD.waiting_for_user) return jsonResponse({ ok: false, reason: 'task not awaiting input' })

          const questionsD: Array<ClarificationQuestion> = taskD.clarification_questions ?? []
          if (clearIdx < 0 || clearIdx >= questionsD.length) {
            return jsonResponse({ error: 'question index out of range' }, 400)
          }

          const updatedQuestionsD = questionsD.map((q, i): ClarificationQuestion => {
            if (i !== clearIdx) return q
            // Strip the answer fields to make this question pending again
            const { answer: _a, answered_at: _at, ...rest } = q
            return rest as ClarificationQuestion
          })

          updateTask(taskD.id, { clarification_questions: updatedQuestionsD })

          const tgD = taskD.clarify_tg
          if (tgD) {
            await editTelegramClarification(tgD, { id: taskD.id, title: taskD.title }, updatedQuestionsD, 'pending')
          }

          return jsonResponse({ ok: true, cleared: clearIdx })
        }

        // ── Mode C: confirm & resume (all questions already answered) ────────
        if (body.confirm === true && typeof body.task_id_prefix === 'string') {
          const prefix = body.task_id_prefix
          if (!prefix) return jsonResponse({ error: 'missing task_id_prefix' }, 400)

          const allTasksC = listTasks({ includeDone: false })
          const taskC = allTasksC.find((t) => t.id.replace(/-/g, '').slice(0, 12) === prefix)
          if (!taskC) return jsonResponse({ error: 'task not found' }, 404)
          if (!taskC.waiting_for_user) return jsonResponse({ ok: false, reason: 'task not awaiting input' })

          const questionsC: Array<ClarificationQuestion> = taskC.clarification_questions ?? []
          const allAnsweredC = questionsC.every((q) => q.answer != null)
          if (!allAnsweredC) return jsonResponse({ ok: false, reason: 'not all questions answered' })

          const tgC = taskC.clarify_tg
          if (tgC) {
            await editTelegramClarification(tgC, { id: taskC.id, title: taskC.title }, questionsC, 'done')
          }

          finalizeAndResume(taskC.id, questionsC, taskC.agent_history ?? [], taskC.column, taskC.agent_name)
          return jsonResponse({ ok: true, resumed: true })
        }

        // ── Mode B: freeform text reply ─────────────────────────────────────
        if (body.reply_to_message_id != null && body.answer_text != null) {
          const replyToId = Number(body.reply_to_message_id)
          const answerText = String(body.answer_text).trim()

          if (isNaN(replyToId) || !answerText) {
            return jsonResponse({ handled: false, error: 'invalid fields' })
          }

          // Find the task whose clarify_tg.message_id matches
          const allTasks = listTasks({ includeDone: false })
          const task = allTasks.find(
            (t) => t.clarify_tg?.message_id === replyToId && t.waiting_for_user,
          )
          if (!task) {
            return jsonResponse({ handled: false })
          }

          const questions: Array<ClarificationQuestion> = task.clarification_questions ?? []
          // Find the first unanswered question — prefer freeform, fall back to any pending
          const pendingFreeform = questions.find((q) => !q.answer && (!q.options || q.options.length === 0))
          const pendingAny = questions.find((q) => !q.answer)
          const target = pendingFreeform ?? pendingAny
          if (!target) {
            return jsonResponse({ handled: false, reason: 'no pending questions' })
          }

          const now = new Date().toISOString()
          const updatedQuestions = questions.map((q): ClarificationQuestion => {
            if (q.id !== target.id) return q
            return { ...q, answer: answerText, answered_at: now }
          })

          updateTask(task.id, { clarification_questions: updatedQuestions })

          const allAnswered = updatedQuestions.every((q) => q.answer != null)
          const messageMode = allAnswered ? 'confirm' : 'pending'
          const tg = task.clarify_tg

          if (tg) {
            await editTelegramClarification(tg, { id: task.id, title: task.title }, updatedQuestions, messageMode)
          }

          // When all answered, show confirm gate instead of auto-resuming.
          // The agent resumes only after the user taps "Confirm & resume" (Mode C).
          return jsonResponse({ handled: true, all_done: allAnswered, awaiting_confirm: allAnswered })
        }

        // ── Mode A: inline keyboard option click ────────────────────────────
        const taskPrefix = typeof body.task_id_prefix === 'string' ? body.task_id_prefix : ''
        const qIndex = Number(body.q_index)
        const optIndex = Number(body.opt_index)

        if (!taskPrefix || isNaN(qIndex) || isNaN(optIndex)) {
          return jsonResponse({ error: 'missing or invalid fields' }, 400)
        }

        const allTasks2 = listTasks({ includeDone: false })
        const task2 = allTasks2.find((t) => t.id.replace(/-/g, '').slice(0, 12) === taskPrefix)
        if (!task2) {
          return jsonResponse({ error: 'task not found', prefix: taskPrefix }, 404)
        }

        const questions2: Array<ClarificationQuestion> = task2.clarification_questions ?? []
        if (qIndex < 0 || qIndex >= questions2.length) {
          return jsonResponse({ error: 'question index out of range' }, 400)
        }

        const question2 = questions2.at(qIndex)
        if (!question2?.options || optIndex < 0 || optIndex >= question2.options.length) {
          return jsonResponse({ error: 'option index out of range' }, 400)
        }

        const selectedAnswer = question2.options[optIndex]
        const now2 = new Date().toISOString()

        const updatedQuestions2 = questions2.map((q, i): ClarificationQuestion => {
          if (i !== qIndex) return q
          return { ...q, answer: selectedAnswer, answered_at: now2 }
        })

        updateTask(task2.id, { clarification_questions: updatedQuestions2 })

        const allAnswered2 = updatedQuestions2.every((q) => q.answer != null)
        const messageMode2 = allAnswered2 ? 'confirm' : 'pending'
        const tg2 = task2.clarify_tg

        if (tg2) {
          await editTelegramClarification(
            tg2,
            { id: task2.id, title: task2.title },
            updatedQuestions2,
            messageMode2,
          )
        }

        // When all answered, show confirm gate instead of auto-resuming.
        // The agent resumes only after the user taps "Confirm & resume" (Mode C).
        return jsonResponse({ ok: true, answered: qIndex, all_done: allAnswered2, awaiting_confirm: allAnswered2 })
      },
    },
  },
})
