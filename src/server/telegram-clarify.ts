import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ClarificationQuestion, TaskRecord } from './tasks-store'

// ---------------------------------------------------------------------------
// Telegram Bot API helpers for task clarification Q&A
// ---------------------------------------------------------------------------

type TgConfig = {
  token: string
  relayBase: string
  chatId: number
}

function loadTgConfig(): TgConfig | null {
  try {
    const envPath = path.join(os.homedir(), '.hermes', '.env')
    const env = fs.readFileSync(envPath, 'utf-8')
    const token = env.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m)?.[1]?.trim()
    if (!token) return null
    const relay = 'https://tg-api.fernandofamily.com/8c778d763c97aa414644fc5bd95da90a'
    return { token, relayBase: relay, chatId: 2130622225 }
  } catch {
    return null
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Build the message text + inline keyboard for the current Q&A state.
// Answered questions appear in the text as ✅ lines; pending ones get button rows.
type TgButton = { text: string; callback_data: string } | { text: string; url: string }

// pending  — some questions still unanswered (show option buttons + edit buttons for answered ones)
// confirm  — all answered, waiting for user to tap "Confirm & resume" (show edit + confirm buttons)
// done     — agent has been resumed (show final state, no buttons)
export type MessageMode = 'pending' | 'confirm' | 'done'

function buildMessage(
  task: Pick<TaskRecord, 'id' | 'title'>,
  questions: Array<ClarificationQuestion>,
  mode: MessageMode = 'pending',
  isReminder = false,
): {
  text: string
  keyboard: Array<Array<TgButton>>
} {
  const taskPrefix = task.id.replace(/-/g, '').slice(0, 12)
  const pendingApp: Array<string> = []
  const keyboard: Array<Array<TgButton>> = []

  const header =
    mode === 'done'
      ? '▶️ <b>Agent is resuming…</b>'
      : mode === 'confirm'
        ? '✅ <b>All answered — confirm to resume</b>'
        : isReminder
          ? '📢 <b>Reminder: still waiting for your input</b>'
          : '❓ <b>Clarification needed</b>'
  let text = `${header}\n<b>Task:</b> ${escapeHtml(task.title)}\n\n`

  questions.forEach((q, qi) => {
    if (q.answer) {
      text += `✅ <b>Q${qi + 1}.</b> ${escapeHtml(q.question)}\n    → ${escapeHtml(q.answer)}\n\n`
      // Edit button lets user clear and re-answer (not shown in final done state)
      if (mode !== 'done') {
        keyboard.push([{ text: `✏️ Edit Q${qi + 1}`, callback_data: `tedit:${taskPrefix}:${qi}` }])
      }
    } else if (q.options && q.options.length > 0) {
      text += `<b>Q${qi + 1}.</b> ${escapeHtml(q.question)}\n`
      const row: Array<TgButton> = q.options.map((opt, oi) => ({
        text: opt,
        callback_data: `task:${taskPrefix}:${qi}:${oi}`,
      }))
      // Custom button opens the web app at the specific task
      row.push({ text: '✏️ Custom', url: `https://agent.fernandofamily.com/tasks?task=${task.id}` })
      keyboard.push(row)
    } else {
      // Freeform question — mark it for reply note
      text += `<b>Q${qi + 1}.</b> ${escapeHtml(q.question)}\n`
      pendingApp.push(`Q${qi + 1}`)
    }
  })

  if (pendingApp.length > 0 && mode === 'pending') {
    text += `\n<i>${pendingApp.join(', ')}: reply to this message with your answer.</i>\n`
    keyboard.push([{ text: '🔗 Open task', url: `https://agent.fernandofamily.com/tasks?task=${task.id}` } satisfies TgButton])
  }

  // Confirm button — shown only when all questions are answered and awaiting confirmation
  if (mode === 'confirm') {
    keyboard.push([{ text: '✅ Confirm & resume agent', callback_data: `tconf:${taskPrefix}` }])
  }

  return { text, keyboard }
}

async function tgPost(cfg: TgConfig, method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${cfg.relayBase}/bot${cfg.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as { ok: boolean; result?: unknown; description?: string }
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`)
  return data.result
}

// Internal: send a clarification message (new or reminder).
async function sendClarificationMessage(
  task: Pick<TaskRecord, 'id' | 'title'>,
  questions: Array<ClarificationQuestion>,
  isReminder: boolean,
): Promise<{ chat_id: number; message_id: number } | null> {
  const cfg = loadTgConfig()
  if (!cfg || questions.length === 0) return null

  const { text, keyboard } = buildMessage(task, questions, 'pending', isReminder)

  try {
    const result = await tgPost(cfg, 'sendMessage', {
      chat_id: cfg.chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    }) as { message_id: number }
    return { chat_id: cfg.chatId, message_id: result.message_id }
  } catch (err) {
    console.error('[telegram-clarify] sendMessage failed:', err)
    return null
  }
}

// Send a new clarification message to Naveen's Telegram DM.
// Returns { chat_id, message_id } for later edits.
export async function sendTelegramClarification(
  task: Pick<TaskRecord, 'id' | 'title'>,
  questions: Array<ClarificationQuestion>,
): Promise<{ chat_id: number; message_id: number } | null> {
  return sendClarificationMessage(task, questions, false)
}

// Send a reminder clarification message (📢 header).
export async function sendTelegramClarificationReminder(
  task: Pick<TaskRecord, 'id' | 'title'>,
  questions: Array<ClarificationQuestion>,
): Promise<{ chat_id: number; message_id: number } | null> {
  return sendClarificationMessage(task, questions, true)
}

// Send a "still working" progress ping — fires every ~5 min while agent_state = 'working'.
export async function sendTelegramProgressPing(
  task: Pick<TaskRecord, 'id' | 'title' | 'agent_name'>,
  elapsedMs: number,
): Promise<void> {
  const cfg = loadTgConfig()
  if (!cfg) return

  const elapsedMin = Math.round(elapsedMs / 60_000)
  const elapsedStr = elapsedMin < 60 ? `${elapsedMin} min` : `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}min`

  const SISTER_EMOJIS: Record<string, string> = {
    astra: '🌟', luna: '🌙', ada: '💻', maya: '🔨', nova: '🔬', novus: '⚙️',
  }
  const agentName = task.agent_name ?? 'astra'
  const agentEmoji = SISTER_EMOJIS[agentName] ?? '🤖'

  const text = `⏳ <b>Agent still working…</b>\n<b>Task:</b> ${escapeHtml(task.title)}\n⏱ ${escapeHtml(agentName)} ${agentEmoji} running for ${elapsedStr}`
  const keyboard: Array<Array<TgButton>> = [[
    { text: '🔗 Open task', url: `https://agent.fernandofamily.com/tasks?task=${task.id}` },
  ]]

  try {
    await tgPost(cfg, 'sendMessage', {
      chat_id: cfg.chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch (err) {
    console.warn('[telegram-clarify] sendTelegramProgressPing failed:', err instanceof Error ? err.message : err)
  }
}

// Send a task-done / task-blocked notification with a deep-link button.
export async function sendTelegramTaskDone(
  task: Pick<TaskRecord, 'id' | 'title'>,
  status: 'done' | 'blocked' | string,
  note: string,
): Promise<void> {
  const cfg = loadTgConfig()
  if (!cfg) return

  const header =
    status === 'done' ? '✅ <b>Task completed</b>' :
    status === 'blocked' ? '🚫 <b>Task blocked</b>' : '⏳ <b>Task update</b>'

  const text = `${header}\n<b>Task:</b> ${escapeHtml(task.title)}\n\n${escapeHtml(note.slice(0, 400))}`
  const keyboard: Array<Array<TgButton>> = [[
    { text: '🔗 Open task', url: `https://agent.fernandofamily.com/tasks?task=${task.id}` },
  ]]

  try {
    await tgPost(cfg, 'sendMessage', {
      chat_id: cfg.chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch (err) {
    console.warn('[telegram-clarify] sendTelegramTaskDone failed:', err instanceof Error ? err.message : err)
  }
}

// Edit the clarification message in place to reflect answered questions.
// mode: 'pending' = still waiting for answers, 'confirm' = all answered awaiting confirm tap,
//       'done' = agent has been resumed (clears all buttons)
export async function editTelegramClarification(
  tgState: { chat_id: number; message_id: number },
  task: Pick<TaskRecord, 'id' | 'title'>,
  questions: Array<ClarificationQuestion>,
  mode: MessageMode = 'pending',
): Promise<void> {
  const cfg = loadTgConfig()
  if (!cfg) return

  const { text, keyboard } = buildMessage(task, questions, mode)

  try {
    await tgPost(cfg, 'editMessageText', {
      chat_id: tgState.chat_id,
      message_id: tgState.message_id,
      text,
      parse_mode: 'HTML',
      reply_markup: mode === 'done' ? undefined : { inline_keyboard: keyboard },
    })
  } catch (err) {
    // Edit may fail if message hasn't changed — that's fine
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('message is not modified')) {
      console.warn('[telegram-clarify] editMessageText:', msg)
    }
  }
}
