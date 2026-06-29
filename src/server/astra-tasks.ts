import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createTask, getTask, listTasks, updateTask } from './tasks-store'
import { openaiChat } from './openai-compat-api'
import { sendTelegramClarification, sendTelegramTaskDone } from './telegram-clarify'
import type { ActivityEntry, TaskColumn, TaskPriority, TaskRecord } from './tasks-store'

// ---------------------------------------------------------------------------
// directChat — calls OpenRouter directly, bypassing the Hermes gateway.
//
// The Hermes gateway injects ~88k tokens of internal memory into every
// request, causing the free model to time out on task analysis (which only
// needs ~1-2k tokens). Going direct drops latency from >45s to <10s.
// Falls back to gateway openaiChat if OpenRouter is unavailable.
// ---------------------------------------------------------------------------

function loadOpenRouterKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  try {
    const envPath = path.join(os.homedir(), '.hermes', '.env')
    const content = fs.readFileSync(envPath, 'utf-8')
    const match = content.match(/^OPENROUTER_API_KEY=(.+)$/m)
    return match?.[1]?.trim() ?? ''
  } catch { return '' }
}

const OR_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'meta-llama/llama-4-maverick:free',
  'google/gemma-3-27b-it:free',
]

async function directChat(
  messages: Array<{ role: string; content: string }>,
  options: { max_tokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<string> {
  const apiKey = loadOpenRouterKey()
  if (!apiKey) throw new Error('No OpenRouter API key')

  for (const model of OR_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options.max_tokens ?? 900,
          temperature: options.temperature ?? 0.4,
        }),
        signal: options.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (res.status === 429 || res.status === 503) continue
        throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`)
      }
      const data = await res.json() as { choices?: Array<{ message?: { content?: string | null } }> }
      const content = data.choices?.[0]?.message?.content ?? ''
      if (content.trim()) return content
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
    }
  }
  throw new Error('All OpenRouter models failed')
}

// Resolve hermes binary path — the systemd service PATH doesn't include ~/.local/bin
function resolveHermesBin(): string {
  const candidates = [
    process.env.HERMES_BIN,
    path.join(os.homedir(), '.local', 'bin', 'hermes'),
    path.join(os.homedir(), '.hermes', 'bin', 'hermes'),
    '/usr/local/bin/hermes',
    'hermes',
  ].filter(Boolean) as Array<string>
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch { /* skip */ }
  }
  // Last resort: ask the shell
  const r = spawnSync('which', ['hermes'], { encoding: 'utf-8' })
  return r.stdout.trim() || 'hermes'
}
const HERMES_BIN = resolveHermesBin()

// ---------------------------------------------------------------------------
// clearStuckTasks — recover tasks whose agent process died without cleanup
//
// Background scripts are killed by OOM, SIGKILL, or server restart before
// they can clear agent_state. This function finds tasks that have been in
// a non-null agent_state longer than the expected timeout and resets them,
// leaving a 'timed_out' history entry so Naveen can see what happened.
// Called on every runAgentDeployBackground() and periodically via setInterval.
// ---------------------------------------------------------------------------

const REVIEWING_TIMEOUT_MS     =  4 * 60 * 1000   //  4 min  (each review call is ≤ 90s × 2)
const WORKING_TIMEOUT_MS       = 25 * 60 * 1000   // 25 min  (hermes -z timeout is 20 min)
const WAITING_INPUT_TIMEOUT_MS = 60 * 60 * 1000   // 60 min  (user needs time to read & answer via Telegram)
const AUTO_RETRY_AFTER_MS      =  4 * 60 * 60 * 1000  // 4h before first auto-retry of a blocked task
const MAX_AUTO_RETRIES         = 2                     // hard cap on auto-retries per task

export function clearStuckTasks(): number {
  const now = Date.now()
  const all = listTasks({ includeDone: true })
  let cleared = 0

  // ── Part 1: recover stuck agent_state ──────────────────────────────────────
  // waiting_for_input gets 60 min — the user may be asleep; working gets 25 min;
  // reviewing/delegating get 4 min (each hermes review call is ≤ 90s).
  for (const task of all) {
    if (!task.agent_state || !task.agent_action_at) continue
    const ageMs = now - new Date(task.agent_action_at).getTime()
    const timeout =
      task.agent_state === 'working'           ? WORKING_TIMEOUT_MS :
      task.agent_state === 'waiting_for_input' ? WAITING_INPUT_TIMEOUT_MS :
      REVIEWING_TIMEOUT_MS
    if (ageMs <= timeout) continue

    const existing = task.agent_history ?? []
    const ageMin   = Math.round(ageMs / 60_000)
    // waiting_for_input: spinner clears but task stays blocked+waiting — the
    // Telegram keyboard and workspace reply path remain valid.
    const note = task.agent_state === 'waiting_for_input'
      ? `No reply received in ${ageMin} min — spinner cleared. Question still open; answer via Telegram or workspace, or press Execute to restart with prior context.`
      : `Agent state "${task.agent_state}" was stuck for ${ageMin} min — auto-cleared. Press Execute to retry.`

    updateTask(task.id, {
      agent_state:     null,
      agent_name:      null,
      agent_action_at: null,
      // For waiting_for_input: keep waiting_for_user=true so the question UI remains visible
      ...(task.agent_state !== 'waiting_for_input' ? { waiting_for_user: false } : {}),
      agent_history:   [...existing, {
        id:      randomUUID(),
        by:      'astra',
        byEmoji: '🌟',
        action:  'timed_out',
        note,
        at:      new Date().toISOString(),
      }],
    })
    cleared++
  }

  // ── Part 2: escalate tasks stuck in 'blocked' without user reply ───────────
  const ESCALATE_AFTER_MS  = 2 * 60 * 60 * 1000  // alert after 2 h blocked
  const ESCALATE_REPEAT_MS = 6 * 60 * 60 * 1000  // repeat at most every 6 h

  for (const task of all) {
    if (task.column !== 'blocked' || task.agent_state) continue
    const history = task.agent_history ?? []

    const lastUserReply   = [...history].reverse().find(e => e.by === 'user' && e.action === 'replied')
    const lastEscalation  = [...history].reverse().find(e => e.action === 'escalated')
    const lastEscalationMs = lastEscalation ? new Date(lastEscalation.at).getTime() : 0

    // Use last user reply, updated_at, or agent_action_at as "last activity" baseline
    const lastActivityMs = Math.max(
      lastUserReply  ? new Date(lastUserReply.at).getTime()  : 0,
      task.updated_at     ? new Date(task.updated_at).getTime()     : 0,
      task.agent_action_at ? new Date(task.agent_action_at).getTime() : 0,
    )
    if (!lastActivityMs || now - lastActivityMs < ESCALATE_AFTER_MS) continue
    if (now - lastEscalationMs < ESCALATE_REPEAT_MS) continue

    const blockedH = Math.round((now - lastActivityMs) / (60 * 60 * 1000))
    const lastNote = [...history].reverse().find(e => e.by !== 'user' && e.note)?.note ?? '(no details)'
    const nowIso   = new Date().toISOString()

    updateTask(task.id, {
      agent_history: [...history, {
        id:      randomUUID(),
        by:      'astra',
        byEmoji: '🌟',
        action:  'escalated',
        note:    `Blocked ${blockedH}h — escalation sent. Reply to unblock or reassign.`,
        at:      nowIso,
      }],
    })

    const tgMsg = `🚫 Still blocked ${blockedH}h: ${task.title}\n${lastNote.slice(0, 220)}\n→ Reply in workspace to unblock or reassign`
    try {
      spawnSync(HERMES_BIN, ['send', '--to', 'telegram:2130622225', '-q', tgMsg], {
        encoding: 'utf-8',
        timeout:  15_000,
      })
    } catch { /* non-fatal */ }
  }

  // ── Part 3: alert on review-loop tasks (>40 history entries stuck >48 h) ───
  const LOOP_HISTORY_THRESHOLD = 40
  const LOOP_AGE_MS    = 48 * 60 * 60 * 1000
  const LOOP_REPEAT_MS = 24 * 60 * 60 * 1000

  for (const task of all) {
    if (task.column !== 'review' && task.column !== 'blocked') continue
    if (task.agent_state) continue
    const history = task.agent_history ?? []
    if (history.length < LOOP_HISTORY_THRESHOLD) continue

    const lastLoopAlert   = [...history].reverse().find(e => e.action === 'loop_alert')
    const lastLoopAlertMs = lastLoopAlert ? new Date(lastLoopAlert.at).getTime() : 0
    if (now - lastLoopAlertMs < LOOP_REPEAT_MS) continue

    const lastActivityMs = Math.max(
      task.updated_at      ? new Date(task.updated_at).getTime()      : 0,
      task.agent_action_at ? new Date(task.agent_action_at).getTime() : 0,
    )
    if (!lastActivityMs || now - lastActivityMs < LOOP_AGE_MS) continue

    const nowIso = new Date().toISOString()
    updateTask(task.id, {
      agent_history: [...history, {
        id:      randomUUID(),
        by:      'astra',
        byEmoji: '🌟',
        action:  'loop_alert',
        note:    `Task has ${history.length} history entries and has been in '${task.column}' >48 h without progress. Consider resolving or pruning.`,
        at:      nowIso,
      }],
    })

    const tgMsg = `⚠️ Review loop: ${task.title}\n${history.length} history entries stuck in ${task.column} >48h — prune or resolve manually.`
    try {
      spawnSync(HERMES_BIN, ['send', '--to', 'telegram:2130622225', '-q', tgMsg], {
        encoding: 'utf-8',
        timeout:  15_000,
      })
    } catch { /* non-fatal */ }
  }

  // ── Part 4: auto-retry execution-blocked tasks (not waiting_for_user) ──────
  // When a task is blocked because the agent hit a runtime error (not a user
  // question), we retry up to MAX_AUTO_RETRIES times after AUTO_RETRY_AFTER_MS.
  // The prior failure context is already in agent_history so the agent can see
  // what was tried. Retries are capped to avoid burning credits in a loop.
  for (const task of all) {
    if (task.column !== 'blocked') continue
    if (task.agent_state) continue                               // active agent — skip
    if (task.waiting_for_user) continue                          // question open — don't interrupt
    if ((task.auto_retry_count ?? 0) >= MAX_AUTO_RETRIES) continue

    // Must have at least one prior agent execution (blocked entry) to retry
    const history = task.agent_history ?? []
    const lastBlockedEntry = [...history].reverse().find(e => e.by !== 'user' && e.action === 'blocked')
    if (!lastBlockedEntry) continue

    // Don't retry if blocked by a user action or if the block was from escalation/loop_alert
    const lastUserActivity = [...history].reverse().find(e => e.by === 'user')
    const lastBlockedMs    = new Date(lastBlockedEntry.at).getTime()
    const lastActivityMs   = Math.max(
      lastUserActivity ? new Date(lastUserActivity.at).getTime() : 0,
      lastBlockedMs,
    )
    if (!lastActivityMs || now - lastActivityMs < AUTO_RETRY_AFTER_MS) continue

    const retryCount = (task.auto_retry_count ?? 0) + 1
    const ageH       = Math.round((now - lastActivityMs) / (60 * 60 * 1000))
    const nowIso     = new Date().toISOString()

    updateTask(task.id, {
      column:           'in_progress',
      auto_retry_count: retryCount,
      auto_retry_at:    nowIso,
      agent_state:      'working',
      agent_name:       task.assignee ?? 'astra',
      agent_action_at:  nowIso,
      agent_history:    [...history, {
        id:      randomUUID(),
        by:      'astra',
        byEmoji: '🌟',
        action:  'auto_retry',
        note:    `Auto-retrying (attempt ${retryCount}/${MAX_AUTO_RETRIES}) after ${ageH}h blocked — prior context included in prompt. No more retries if this fails.`,
        at:      nowIso,
      }],
    })

    // Fire execution in a background subprocess — fully detached, non-blocking
    executeTaskWithHermesBackground(task.id)
  }

  // ── Part 5: auto-archive stale todo/backlog tasks (> 60 days, no activity) ──
  // Prevents the Deploy sweep from being diluted by hundreds of ancient tasks.
  const STALE_TODO_MS = 60 * 24 * 60 * 60 * 1000  // 60 days
  let archived = 0

  for (const task of all) {
    if (task.column !== 'todo' && task.column !== 'backlog') continue
    if (task.agent_state) continue
    const history = task.agent_history ?? []
    const lastActivity = Math.max(
      task.updated_at ? new Date(task.updated_at).getTime() : 0,
      task.created_at ? new Date(task.created_at).getTime() : 0,
      history.length ? new Date(history[history.length - 1].at).getTime() : 0,
    )
    if (!lastActivity || now - lastActivity < STALE_TODO_MS) continue

    const ageD = Math.round((now - lastActivity) / (24 * 60 * 60 * 1000))
    const nowIso = new Date().toISOString()
    updateTask(task.id, {
      column: 'done',
      agent_history: [...history, {
        id:      randomUUID(),
        by:      'astra',
        byEmoji: '🌟',
        action:  'archived',
        note:    `Auto-archived after ${ageD} days of inactivity in ${task.column}. Move back to todo to restart.`,
        at:      nowIso,
      }],
    })
    archived++
  }

  if (archived > 0) {
    console.log(`[clearStuckTasks] Auto-archived ${archived} stale tasks (>60 days inactive)`)
  }

  return cleared
}

// Periodic stuck-task sweep: every 10 minutes while the server is running.
setInterval(clearStuckTasks, 10 * 60 * 1000)

// Periodic deploy sweep: every 15 minutes, pick up any unreviewed tasks that
// slipped through (server restart broke a self-chain, tasks moved back to
// backlog manually, etc.). Only touches tasks no agent has reviewed yet —
// tasks already in the pipeline are left alone.
setInterval(() => {
  try { runAgentDeployBackground('auto') } catch { /* non-fatal */ }
}, 15 * 60 * 1000)

// ---------------------------------------------------------------------------
// markTasksAsReviewing
// ---------------------------------------------------------------------------

export function markTasksAsReviewing(taskIds: Array<string>): void {
  const now = new Date().toISOString()
  for (const id of taskIds) {
    updateTask(id, {
      agent_state: 'reviewing',
      agent_name: 'astra',
      agent_action_at: now,
    })
  }
}

// ---------------------------------------------------------------------------
// runAstraReviewBackground
// ---------------------------------------------------------------------------

export function runAstraReviewBackground(): { taskCount: number } {
  const candidates = listTasks({ column: 'backlog' }).concat(listTasks({ column: 'todo' }))

  if (candidates.length === 0) {
    return { taskCount: 0 }
  }

  // Mark all as reviewing immediately (synchronous, before we fork)
  markTasksAsReviewing(candidates.map((t) => t.id))

  // Build the summary payload for the hermes prompt
  const taskSummary = candidates.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
  }))

  const prompt = `You are Astra, reviewing the task board backlog for the Hermes workspace.
For each task below, decide:
1. Is it feasible? (yes/no)
2. Priority: high/medium/low
3. Best assignee from: orchestrator, builder, reviewer, researcher, qa, ops-watch, maintainer, strategist, inbox-triage, km-agent (or null)
4. Should it move from backlog to: "todo" (ready to work), "blocked" (needs more info), or stay "backlog"

Return a JSON array: [{"id": "...", "feasible": true, "priority": "high", "assignee": "builder", "column": "todo", "reason": "..."}]

Tasks:
${JSON.stringify(taskSummary, null, 2)}`

  const tasksFilePath = path.join(
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes'),
    'tasks.json',
  )

  // Escape values for embedding in the script string
  const promptEscaped = JSON.stringify(prompt)
  const tasksFilePathEscaped = JSON.stringify(tasksFilePath)
  const hermesBinEscaped = JSON.stringify(HERMES_BIN)

  const scriptContent = `
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const TASKS_FILE = ${tasksFilePathEscaped};
const prompt = ${promptEscaped};

// Helper: read tasks.json
function readTasks() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8').trim();
    if (!raw) return { tasks: [] };
    const parsed = JSON.parse(raw);
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch {
    return { tasks: [] };
  }
}

// Helper: write tasks.json (atomic via rename)
function writeTasks(data) {
  const content = JSON.stringify(data, null, 2) + '\\n';
  const tmp = TASKS_FILE + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, TASKS_FILE);
}

// Helper: clear agent state on a set of task ids
function clearAgentState(taskIds) {
  const file = readTasks();
  const now = new Date().toISOString();
  file.tasks = file.tasks.map((t) => {
    if (taskIds.includes(t.id)) {
      return { ...t, agent_state: null, agent_name: null, agent_action_at: null, updated_at: now };
    }
    return t;
  });
  writeTasks(file);
}

// Call hermes CLI
const hermesBin = ${hermesBinEscaped};
const result = spawnSync(
  hermesBin,
  ['-z', prompt],
  { encoding: 'utf-8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 }
);

const taskIds = ${JSON.stringify(candidates.map((t) => t.id))};

if (result.status !== 0 || !result.stdout) {
  // hermes failed — just clear agent state
  clearAgentState(taskIds);
  process.exit(0);
}

// Try to extract a JSON array from the response
let updates = null;
try {
  const text = result.stdout.trim();
  // Try direct parse first
  try {
    updates = JSON.parse(text);
  } catch {
    // Find first [ ... ] block in the response
    const match = text.match(/\\[\\s*\\{[\\s\\S]*?\\}\\s*\\]/);
    if (match) {
      updates = JSON.parse(match[0]);
    }
  }
} catch {
  updates = null;
}

if (!Array.isArray(updates)) {
  // Could not parse — clear agent state without making priority changes
  clearAgentState(taskIds);
  process.exit(0);
}

// Apply updates directly to tasks.json
const file = readTasks();
const now = new Date().toISOString();
file.tasks = file.tasks.map((t) => {
  const upd = updates.find((u) => u.id === t.id);
  if (!upd) return t;
  return {
    ...t,
    priority: upd.priority ?? t.priority,
    assignee: upd.assignee !== undefined ? upd.assignee : t.assignee,
    column: upd.column ?? t.column,
    agent_state: null,
    agent_name: null,
    agent_action_at: null,
    updated_at: now,
  };
});
writeTasks(file);
process.exit(0);
`

  // Write the script to a temp file
  const timestamp = Date.now()
  const scriptPath = `/tmp/astra-review-${timestamp}.mjs`
  fs.writeFileSync(scriptPath, scriptContent, 'utf-8')

  // Spawn the script detached so the server process doesn't wait for it
  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return { taskCount: candidates.length }
}

// ---------------------------------------------------------------------------
// runAgentDeployBackground — sequential per-task review with sister delegation
// ---------------------------------------------------------------------------

// mode 'auto'  → periodic sweep: only picks tasks no agent has touched yet
// mode 'manual' (default) → user-triggered: picks any eligible task, re-review OK
export function runAgentDeployBackground(mode: 'manual' | 'auto' = 'manual'): { taskCount: number } {
  clearStuckTasks()

  const PRIORITY_SCORE: Record<string, number> = { high: 3, medium: 2, low: 1 }
  const allEligible = listTasks({ column: 'backlog' }).concat(listTasks({ column: 'todo' }))
    .sort((a, b) => {
      const pa = PRIORITY_SCORE[a.priority] ?? 2
      const pb = PRIORITY_SCORE[b.priority] ?? 2
      if (pb !== pa) return pb - pa                       // high priority first
      const da = new Date(a.created_at).getTime()
      const db = new Date(b.created_at).getTime()
      return da - db                                      // older tasks first within same priority
    })
  const MAX_PER_CYCLE = 3

  // Build a set of done task IDs to resolve depends_on checks
  const doneTasks = new Set(listTasks({ includeDone: true })
    .filter(t => t.column === 'done')
    .map(t => t.id))

  const candidates = allEligible.filter((t) => {
    if (t.agent_state) return false
    // Skip tasks whose dependencies are not yet done — they should wait silently in todo
    if (Array.isArray(t.depends_on) && t.depends_on.length > 0) {
      if (!t.depends_on.every(depId => doneTasks.has(depId))) return false
    }
    if (mode === 'auto') {
      // Skip tasks an agent has already reviewed — they're waiting for Execute
      return !(t.agent_history ?? []).some((e) => e.by !== 'user')
    }
    return true
  }).slice(0, MAX_PER_CYCLE)

  if (candidates.length === 0) return { taskCount: 0 }

  // Mark all as reviewing synchronously, before the fork
  markTasksAsReviewing(candidates.map((c) => c.id))

  const hermesHome =
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
  const tasksFilePath = path.join(hermesHome, 'tasks.json')

  const taskPayload = candidates.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    column: t.column,
    assignee: t.assignee,
  }))

  const scriptContent = `
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const TASKS_FILE  = ${JSON.stringify(tasksFilePath)};
const HERMES_BIN  = ${JSON.stringify(HERMES_BIN)};
const HERMES_HOME = ${JSON.stringify(hermesHome)};
const TASKS       = ${JSON.stringify(taskPayload)};
const TG_TARGET   = 'telegram:2130622225';

const SISTER_EMOJIS   = { astra: '🌟', luna: '🌙', ada: '💻', maya: '🔨', nova: '🔬', novus: '⚙️', user: '👤' };
const VALID_SISTERS   = ['luna', 'ada', 'maya', 'nova', 'novus'];
const VALID_COLUMNS   = ['backlog', 'todo', 'in_progress', 'review', 'blocked'];
// Maps assignee names → hermes profile dirs for execution routing
const SISTER_PROFILES = {
  ada: 'coder', coder: 'coder', qa: 'coder', reviewer: 'coder',
  maya: 'builder', builder: 'builder', maintainer: 'builder', 'ops-watch': 'builder',
  luna: 'researcher', researcher: 'researcher',
  nova: 'nova', novus: 'novus', local: 'novus',
};

const LOCK_FILE = TASKS_FILE + '.lock';

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

// Cross-process advisory lock — same semantics as tasks-store.ts withTasksLock.
function withTasksLock(fn) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(LOCK_FILE, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
      fs.closeSync(fd);
      try { return fn(); } finally { try { fs.unlinkSync(LOCK_FILE); } catch {} }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { const s = fs.statSync(LOCK_FILE); if (Date.now() - s.mtimeMs > 30_000) { fs.unlinkSync(LOCK_FILE); continue; } } catch {}
      sleep(50);
    }
  }
  return fn(); // timeout: proceed rather than deadlock
}

function readTasks() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8').trim();
    if (!raw) return { tasks: [] };
    const parsed = JSON.parse(raw);
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch { return { tasks: [] }; }
}

function writeTasks(data) {
  const content = JSON.stringify(data, null, 2) + '\\n';
  const tmp = TASKS_FILE + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, TASKS_FILE);
}

function getTaskDirect(taskId) {
  return readTasks().tasks.find(t => t.id === taskId) || null;
}

// Lock covers the full read-modify-write so no concurrent process can interleave.
function updateTaskDirect(taskId, updates) {
  withTasksLock(() => {
    const file = readTasks();
    const idx = file.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    file.tasks[idx] = { ...file.tasks[idx], ...updates, updated_at: new Date().toISOString() };
    writeTasks(file);
  });
}

function callHermes(prompt, profileDir) {
  const profileArgs = profileDir ? ['--profile', profileDir] : [];
  const r = spawnSync(HERMES_BIN, [...profileArgs, '-z', prompt], { encoding: 'utf-8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  return r.stdout || '';
}

function parseJSON(text) {
  const t = (text || '').trim();
  try { return JSON.parse(t); } catch {}
  const m1 = t.match(/\\{[\\s\\S]*\\}/);
  if (m1) { try { return JSON.parse(m1[0]); } catch {} }
  const m2 = t.match(/\\[[\\s\\S]*\\]/);
  if (m2) { try { return JSON.parse(m2[0]); } catch {} }
  return null;
}

function getSoulMd(sister) {
  try {
    const p = path.join(HERMES_HOME, 'profiles', sister, 'SOUL.md');
    return fs.readFileSync(p, 'utf-8').slice(0, 600);
  } catch { return ''; }
}

function sendTelegram(msg) {
  try { spawnSync(HERMES_BIN, ['send', '--to', TG_TARGET, '-q', msg], { encoding: 'utf-8', timeout: 15_000 }); } catch {}
}

async function sendTelegramClarificationKeyboard(taskId, taskTitle, questions) {
  let token = '';
  try {
    const envPath = path.join(os.homedir(), '.hermes', '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    token = match ? match[1].trim() : '';
  } catch {}
  if (!token) { sendTelegram('❓ Clarification needed\\nTask: ' + taskTitle); return; }
  const relayBase = 'https://tg-api.fernandofamily.com/8c778d763c97aa414644fc5bd95da90a';
  const chatId = 2130622225;
  const taskPrefix = taskId.replace(/-/g, '').slice(0, 12);
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  let text = '❓ <b>Clarification needed</b>\\n<b>Task:</b> ' + escHtml(taskTitle) + '\\n\\n';
  const keyboard = [];
  const pendingApp = [];
  questions.forEach(function(q, qi) {
    text += '<b>Q' + (qi + 1) + '.</b> ' + escHtml(q.question) + '\\n';
    if (q.options && q.options.length > 0) {
      const row = q.options.map(function(opt, oi) {
        return { text: opt, callback_data: 'task:' + taskPrefix + ':' + qi + ':' + oi };
      });
      row.push({ text: '✏️ Custom', url: 'https://agent.fernandofamily.com/tasks?task=' + taskId });
      keyboard.push(row);
    } else {
      pendingApp.push('Q' + (qi + 1));
    }
  });
  if (pendingApp.length > 0) {
    text += '\\n<i>' + pendingApp.join(', ') + ': reply to this message with your answer.</i>\\n';
    keyboard.push([{ text: '🔗 Open task', url: 'https://agent.fernandofamily.com/tasks?task=' + taskId }]);
  }
  try {
    const res = await fetch(relayBase + '/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }),
    });
    const data = await res.json();
    if (data.ok && data.result && data.result.message_id) {
      updateTaskDirect(taskId, { clarify_tg: { chat_id: chatId, message_id: data.result.message_id } });
    } else {
      sendTelegram('\\u2753 Clarification needed\\nTask: ' + taskTitle);
    }
  } catch (e) {
    sendTelegram('\\u2753 Clarification needed\\nTask: ' + taskTitle);
  }
}

// Shared WORK_SUMMARY parser used for auto-execution results
function parseWorkSummary(output, stderr, exitCode) {
  let status = 'partial', summary = '', next = '', question = '';
  const block = output.match(/<WORK_SUMMARY>([\\s\\S]*?)<\\/WORK_SUMMARY>/)?.[1] ?? '';
  const src   = block || (output.match(/^STATUS:/im) ? output : '');
  if (src) {
    const sm = src.match(/STATUS:\\s*(\\w+)/i);
    const su = src.match(/SUMMARY:\\s*(.+)/i);
    const nx = src.match(/NEXT:\\s*(.+)/i);
    const q  = src.match(/QUESTION:\\s*(.+)/i);
    if (sm) status   = sm[1].toLowerCase();
    if (su) summary  = su[1].trim().replace(/^\\[|\\]$/g, '');
    if (nx) next     = nx[1].trim().replace(/^\\[|\\]$/g, '');
    if (q)  question = q[1].trim().replace(/^\\[|\\]$/g, '');
  }
  if (exitCode !== 0 && status === 'partial') {
    status  = 'blocked';
    summary = summary || ('hermes exited with code ' + exitCode + (stderr ? ': ' + stderr.slice(0, 200) : ''));
  }
  const freeText = output.replace(/<WORK_SUMMARY>[\\s\\S]*?<\\/WORK_SUMMARY>/g, '').trim();
  const note = summary || freeText.slice(0, 800) ||
    (exitCode !== 0 ? 'Execution failed (exit ' + exitCode + '): ' + stderr.slice(0, 200) : 'Task executed — no summary returned.');
  const parts = [note];
  if (next && next !== '...') parts.push('→ ' + next);
  if (question) parts.push('Needs input: ' + question);
  return {
    status,
    note: parts.join('\\n\\n'),
    actionLabel: status === 'done' ? 'completed' : (status === 'blocked' || status === 'needs_input') ? 'blocked' : 'attempted',
    newColumn:   status === 'done' ? 'review'    : (status === 'blocked' || status === 'needs_input') ? 'blocked' : null,
  };
}

// Break a task into subtasks and write them to tasks.json
function doBreakdown(task, assignee) {
  updateTaskDirect(task.id, { agent_state: 'reviewing', agent_name: 'astra', agent_action_at: new Date().toISOString() });
  const breakdownPrompt =
    'Break this task into 3-6 concrete, independently completable subtasks.\\n\\n' +
    'Task: ' + task.title + '\\n' +
    'Description: ' + (task.description || '(none)') + '\\n' +
    'Assignee: ' + (assignee || 'unassigned') + '\\n\\n' +
    'Return ONLY a valid JSON array, no other text:\\n' +
    '[{"title":"...","description":"what to do and definition of done","priority":"high|medium|low","assignee":"' + (assignee || 'null') + '"}]';

  const raw = callHermes(breakdownPrompt);
  let subtasks = null;
  try {
    const t = (raw || '').trim();
    try { subtasks = JSON.parse(t); } catch {}
    if (!Array.isArray(subtasks)) { const m = t.match(/\\[[\\s\\S]*\\]/); if (m) subtasks = JSON.parse(m[0]); }
  } catch {}
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    updateTaskDirect(task.id, { agent_state: null, agent_name: null, agent_action_at: null });
    return 0;
  }

  const MAX_SUBTASKS = 6;
  const titles = [];
  const now = new Date().toISOString();
  withTasksLock(() => {
    const file = readTasks();
    const existingTitles = new Set(file.tasks.map(function(t) { return t.title.toLowerCase().trim(); }));
    let pushed = 0;
    for (const sub of subtasks) {
      if (!sub.title || pushed >= MAX_SUBTASKS) continue;
      const normalized = sub.title.trim().toLowerCase();
      if (existingTitles.has(normalized)) continue;
      file.tasks.push({
        id: randomUUID(), title: sub.title.trim(), description: sub.description || '',
        column: 'todo', priority: sub.priority || task.priority,
        assignee: sub.assignee && sub.assignee !== 'null' ? sub.assignee : (assignee || null),
        tags: ['subtask'], due_date: null, position: 0,
        created_by: 'astra', created_at: now, updated_at: now,
        session_id: null, agent_state: null, agent_name: null, agent_action_at: null,
        source: 'astra', agent_comment: null, agent_history: [], waiting_for_user: false,
      });
      titles.push(sub.title.trim());
      existingTitles.add(normalized);
      pushed++;
    }
    writeTasks(file);
  });

  const count = titles.length;
  const note  = 'Auto-broke down into ' + count + ' subtask' + (count !== 1 ? 's' : '') + ': ' + titles.slice(0, 3).join(', ') + (count > 3 ? '…' : '');
  const cur   = getTaskDirect(task.id);
  const exH   = (cur && Array.isArray(cur.agent_history)) ? cur.agent_history : [];
  updateTaskDirect(task.id, {
    agent_comment: note,
    agent_history: [...exH, { id: randomUUID(), by: 'astra', byEmoji: '🌟', action: 'broke down', note, at: now }],
    agent_state: null, agent_name: null, agent_action_at: null,
  });
  return count;
}

// ── Phase 1: Review all tasks ────────────────────────────────────────────────

const sisterReviewQueue = [];

for (const task of TASKS) {
  updateTaskDirect(task.id, { agent_state: 'reviewing', agent_name: 'astra', agent_action_at: new Date().toISOString() });

  const astraPrompt =
    'You are Astra. Review this task for the Hermes Workspace Kanban board.\\n\\n' +
    'Task ID: ' + task.id + '\\n' +
    'Title: ' + task.title + '\\n' +
    'Description: ' + (task.description || '(none)') + '\\n' +
    'Current column: ' + task.column + ' | Priority: ' + task.priority + '\\n\\n' +
    'Decide:\\n' +
    '1. priority: high/medium/low\\n' +
    '2. column: "todo" (ready to work), "blocked" (needs more info), "backlog" (not yet ready)\\n' +
    '3. assignee: luna | ada | maya | nova | novus | qa | ops-watch | maintainer | orchestrator | null\\n' +
    '4. sister_needed: null | "luna" (research/docs) | "ada" (code review) | "maya" (build/infra) | "nova" (web research)\\n' +
    '5. dispatch — how to proceed after this review:\\n' +
    '   "auto_execute"   → task is clear; sister will write a plan first (cheap), then wait for Naveen to press Execute (cost gate)\\n' +
    '   "auto_breakdown" → task is too large or has distinct independent parts — split into subtasks first\\n' +
    '   "needs_input"    → ONLY when you literally cannot begin step 1 without a secret/credential not available in env (e.g. API key, account number). Do NOT use for general ambiguity, uncertain scope, or missing details — use "manual" instead. NEVER block multiple tasks for the same missing prerequisite; mention the shared gap in astra_note and set column="todo" so tasks wait silently.\\n' +
    '   "manual"         → unclear scope, policy call, general uncertainty, or anything sensitive — DEFAULT choice when in doubt\\n' +
    '6. question: (required when dispatch is needs_input) the exact question to ask Naveen\\n' +
    '7. astra_note: 1-2 sentence summary of your reasoning\\n\\n' +
    'Return ONLY valid JSON, no other text:\\n' +
    '{"id":"...","priority":"medium","column":"todo","assignee":"ada","sister_needed":null,"dispatch":"manual","question":"","astra_note":"..."}';

  const astraText   = callHermes(astraPrompt);
  const astraResult = parseJSON(astraText);

  if (!astraResult) {
    updateTaskDirect(task.id, { agent_state: null, agent_name: null, agent_action_at: null });
    continue;
  }

  const { priority, column, assignee, sister_needed, dispatch, question, astra_note } = astraResult;
  const historyToAdd = [];
  const astraEntry   = {
    id: randomUUID(), by: 'astra', byEmoji: '🌟', action: 'reviewed',
    note: astra_note || 'Reviewed by Astra.', at: new Date().toISOString()
  };
  historyToAdd.push(astraEntry);
  let finalNote = astraEntry.note;

  if (sister_needed && VALID_SISTERS.includes(sister_needed)) {
    updateTaskDirect(task.id, { agent_state: 'delegating', agent_name: sister_needed, agent_action_at: new Date().toISOString() });
    const soulMd      = getSoulMd(sister_needed);
    const sisterPrompt =
      (soulMd ? soulMd + '\\n\\n' : '') +
      'You are reviewing a task that Astra delegated to you because it needs your specialty.\\n\\n' +
      'Task: ' + task.title + '\\n' +
      'Description: ' + (task.description || '(none)') + '\\n' +
      "Astra's note: " + astraEntry.note + '\\n\\n' +
      'Give your specialist assessment in 2-3 sentences. Return ONLY valid JSON:\\n' +
      '{"note":"...","action":"reviewed"}';

    const sisterResult = parseJSON(callHermes(sisterPrompt));
    if (sisterResult?.note) {
      historyToAdd.push({
        id: randomUUID(), by: sister_needed, byEmoji: SISTER_EMOJIS[sister_needed] || '🤖',
        action: sisterResult.action || 'reviewed', note: sisterResult.note, at: new Date().toISOString()
      });
      finalNote = sisterResult.note;
    }
  }

  const current         = getTaskDirect(task.id);
  const existingHistory = (current && Array.isArray(current.agent_history)) ? current.agent_history : [];
  const resolvedAssignee =
    (sister_needed && VALID_SISTERS.includes(sister_needed))
      ? sister_needed
      : (assignee !== undefined ? assignee : task.assignee);
  const resolvedColumn = VALID_COLUMNS.includes(column) ? column : task.column;

  updateTaskDirect(task.id, {
    priority: priority || task.priority,
    column: resolvedColumn,
    assignee: resolvedAssignee,
    agent_comment: finalNote,
    agent_history: [...existingHistory, ...historyToAdd],
    agent_state: null, agent_name: null, agent_action_at: null,
  });

  // ── Act on dispatch decision ─────────────────────────────────────────────
  const safeDispatch = (dispatch || 'manual').toLowerCase();

  if (safeDispatch === 'needs_input' && question) {
    // Block and ping Naveen immediately
    const qEntry = { id: randomUUID(), by: 'astra', byEmoji: '🌟', action: 'question', note: question, at: new Date().toISOString() };
    updateTaskDirect(task.id, {
      column: 'blocked', waiting_for_user: true,
      agent_history: [...existingHistory, ...historyToAdd, qEntry],
    });
    sendTelegram('❓ 🌟 Astra needs your input\\nTask: ' + task.title + '\\n' + question.slice(0, 300));

  } else if (safeDispatch === 'auto_breakdown') {
    const count = doBreakdown(task, resolvedAssignee);
    if (count > 0) sendTelegram('🔀 🌟 Astra broke down: ' + task.title + ' → ' + count + ' subtasks ready in todo');

  } else if (safeDispatch === 'auto_execute' && resolvedColumn === 'todo') {
    sisterReviewQueue.push({ id: task.id, title: task.title, description: task.description, assignee: resolvedAssignee });
    const dispatchEntry = { id: randomUUID(), by: 'astra', byEmoji: '🌟', action: 'dispatching', note: 'Queued for sister review — she will plan, then wait for Execute.', at: new Date().toISOString() };
    updateTaskDirect(task.id, { agent_history: [...existingHistory, ...historyToAdd, dispatchEntry] });
  }
  // 'manual' → no further action; user presses Execute when ready
}

// ── Phase 2: Sister review + plan (cheap ~90s gate; execution stays manual) ──
// Each assigned sister reads the task and writes a concrete implementation plan.
// After planning the task moves to "review" column — a cost gate where Naveen
// can read the plan and press Execute only when satisfied.
// If the sister says re_assign, we redirect once to the right specialist.
// If the sister needs input, we block and ping Naveen via Telegram.

for (const reviewTask of sisterReviewQueue) {
  let assignee = reviewTask.assignee || 'astra';
  let redirectDone = false;

  // Allow one re-assignment redirect
  for (let hop = 0; hop <= 1; hop++) {
    const profileDir  = SISTER_PROFILES[assignee] || '';
    const sisterEmoji = SISTER_EMOJIS[assignee] || '🌟';
    const soulMd      = getSoulMd(profileDir || assignee);

    updateTaskDirect(reviewTask.id, {
      agent_state: 'reviewing', agent_name: assignee, agent_action_at: new Date().toISOString(),
    });

    const planPrompt =
      (soulMd ? soulMd + '\\n\\n' : '') +
      'You have been assigned this task. Write a concrete step-by-step implementation plan.\\n' +
      'Do NOT execute anything yet — just plan.\\n\\n' +
      'Task: ' + reviewTask.title + '\\n' +
      (reviewTask.description ? 'Description: ' + reviewTask.description + '\\n' : '') +
      '\\nDecide:\\n' +
      '  action: "ready"      → you can handle this; include a numbered plan\\n' +
      '  action: "re_assign"  → wrong specialist; name the right one in reassign_to\\n' +
      '  action: "needs_input"→ missing info; write your question in question field\\n\\n' +
      'Return ONLY valid JSON:\\n' +
      '{"action":"ready","plan":"1. ...\\\\n2. ...\\\\n3. ...","reassign_to":null,"question":""}';

    const planResult = parseJSON(callHermes(planPrompt, profileDir));
    const cur = getTaskDirect(reviewTask.id);
    const exH = Array.isArray(cur?.agent_history) ? cur.agent_history : [];
    const now = new Date().toISOString();

    if (!planResult || planResult.action === 'ready' || hop === 1 || !planResult.action) {
      // Gate stop: move to review column with sister's plan
      const planNote = (planResult?.plan) || '(Plan unavailable — press Execute to proceed.)';
      updateTaskDirect(reviewTask.id, {
        column: 'review',
        assignee,
        agent_comment: planNote,
        agent_state: null, agent_name: null, agent_action_at: null,
        agent_history: [...exH, {
          id: randomUUID(), by: assignee, byEmoji: sisterEmoji,
          action: 'planned', note: planNote, at: now,
        }],
      });
      sendTelegram('📋 ' + sisterEmoji + ' ' + assignee + ' has a plan\\nTask: ' + reviewTask.title + '\\n' + planNote.slice(0, 250) + '\\n\\n→ Check review column, press Execute when ready.');
      break;
    }

    if (planResult.action === 're_assign' && !redirectDone && planResult.reassign_to && VALID_SISTERS.includes(planResult.reassign_to)) {
      // Redirect to the correct sister
      const redirectNote = (planResult.plan || 'Re-assigning to ' + planResult.reassign_to + '.');
      updateTaskDirect(reviewTask.id, {
        assignee: planResult.reassign_to,
        agent_history: [...exH, {
          id: randomUUID(), by: assignee, byEmoji: sisterEmoji,
          action: 're-assigned', note: redirectNote, at: now,
        }],
      });
      assignee = planResult.reassign_to;
      redirectDone = true;
      continue;
    }

    if (planResult.action === 'needs_input' && planResult.question) {
      updateTaskDirect(reviewTask.id, {
        column: 'blocked', waiting_for_user: true, assignee,
        agent_state: null, agent_name: null, agent_action_at: null,
        agent_history: [...exH, {
          id: randomUUID(), by: assignee, byEmoji: sisterEmoji,
          action: 'question', note: planResult.question, at: now,
        }],
      });
      sendTelegram('❓ ' + sisterEmoji + ' ' + assignee + ' needs your input\\nTask: ' + reviewTask.title + '\\n' + planResult.question.slice(0, 300));
      break;
    }

    // Fallback: treat as ready
    const planNote = planResult.plan || '(No plan — press Execute to proceed.)';
    updateTaskDirect(reviewTask.id, {
      column: 'review', assignee,
      agent_comment: planNote,
      agent_state: null, agent_name: null, agent_action_at: null,
      agent_history: [...exH, {
        id: randomUUID(), by: assignee, byEmoji: sisterEmoji,
        action: 'planned', note: planNote, at: now,
      }],
    });
    sendTelegram('📋 ' + sisterEmoji + ' ' + assignee + ' has a plan\\nTask: ' + reviewTask.title + '\\n' + planNote.slice(0, 250) + '\\n\\n→ Press Execute when ready.');
    break;
  }
}

// Continuation is handled by the TS-side periodic sweep (15 min) and the
// MAX_PER_CYCLE batch — no HTTP self-chain needed.
`

  const timestamp = Date.now()
  const scriptPath = `/tmp/deploy-agents-${timestamp}.mjs`
  fs.writeFileSync(scriptPath, scriptContent, 'utf-8')

  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return { taskCount: candidates.length }
}

// ---------------------------------------------------------------------------
// resolveSisterAndCwd — maps task assignee/tags to the right sister + CWD
// ---------------------------------------------------------------------------

type SisterResolution = {
  profileDir: string
  displayName: string
  emoji: string
  workCwd: string
}

function resolveSisterAndCwd(task: Pick<TaskRecord, 'assignee' | 'tags' | 'column'>): SisterResolution {
  const assignee = (task.assignee ?? '').toLowerCase()

  let profileDir = ''
  let displayName = 'Astra'
  let emoji = '🌟'

  if (['ada', 'coder', 'qa', 'reviewer'].includes(assignee)) {
    // Ada: code generation, review, quality assurance
    profileDir = 'coder'; displayName = 'Ada'; emoji = '💻'
  } else if (['maya', 'builder', 'maintainer', 'ops-watch'].includes(assignee)) {
    // Maya: building, infra, maintenance, ops
    profileDir = 'builder'; displayName = 'Maya'; emoji = '🔨'
  } else if (['luna', 'researcher'].includes(assignee)) {
    // Luna: research, docs, deep synthesis
    profileDir = 'researcher'; displayName = 'Luna'; emoji = '🌙'
  } else if (assignee === 'nova') {
    // Nova: web research, browser, vision
    profileDir = 'nova'; displayName = 'Nova'; emoji = '🔬'
  } else if (['novus', 'local'].includes(assignee)) {
    // Novus: local/private tasks via Ollama (zero cost)
    profileDir = 'novus'; displayName = 'Novus'; emoji = '⚙️'
  }
  // orchestrator, strategist, inbox-triage, km-agent → Astra default (no profile change)

  const tags = task.tags
  const hermesTags = ['ui', 'dashboard', 'hermes', 'self-improvement']

  let workCwd = process.cwd()

  if (tags.some(t => t === 'project:hermes-workspace' || hermesTags.includes(t.toLowerCase()))) {
    workCwd = '/home/ubuntu/hermes-workspace'
  } else {
    const projectTag = tags.find(t => t.startsWith('project:'))
    if (projectTag) {
      const proj = projectTag.replace('project:', '')
      const c1 = `/srv/projects/${proj}`
      const c2 = `/srv/projects/projects/${proj}`
      if (fs.existsSync(c1)) workCwd = c1
      else if (fs.existsSync(c2)) workCwd = c2
    }
  }

  return { profileDir, displayName, emoji, workCwd }
}

// ---------------------------------------------------------------------------
// loadAstraPersonality — reads SOUL.md for Astra's persona
// ---------------------------------------------------------------------------

function loadAstraPersonality(): string {
  try {
    const soulPath = path.join(os.homedir(), '.hermes', 'SOUL.md')
    const soul = fs.readFileSync(soulPath, 'utf-8')
    // Extract "Who You Are" + identity section for personality context
    const whoSection = soul.match(/## Who You Are[\s\S]*?(?=\n## )/)?.[0] ?? ''
    const identitySection = soul.match(/## Identity[\s\S]*?(?=\n## )/)?.[0] ?? ''
    return [whoSection, identitySection].filter(Boolean).join('\n\n').slice(0, 800)
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// executeTaskBackground — in-process AI task analysis via openaiChat
// ---------------------------------------------------------------------------

export function executeTaskBackground(taskId: string): void {
  const task = getTask(taskId)
  if (!task) return

  const { displayName, emoji, workCwd } = resolveSisterAndCwd(task)
  const personality = loadAstraPersonality()

  let recentCommits = ''
  try {
    const r = spawnSync('git', ['log', '--oneline', '-5'], { encoding: 'utf-8', cwd: workCwd, timeout: 5000 })
    if (r.stdout.trim()) recentCommits = r.stdout.trim()
  } catch { /* ok */ }

  // Build conversation context from history (agent replies + user replies)
  const history = task.agent_history ?? []
  const conversationEntries = history.filter(e =>
    e.action === 'question' || e.action === 'replied' || e.action === 'analyzed' || e.action === 'completed'
  ).slice(-8)

  const hasConversation = conversationEntries.length > 0
  const conversationContext = conversationEntries
    .map(e => {
      if (e.by === 'user') return `[Naveen] ${e.note}`
      if (e.action === 'question') return `[Astra asked] ${e.note}`
      return `[Astra] ${e.note}`
    })
    .join('\n')

  const taskLines = [
    `Task: ${task.title}`,
    `Status: ${task.column} | Priority: ${task.priority}${task.tags.length ? ' | Tags: ' + task.tags.join(', ') : ''}`,
    task.description ? `Description: ${task.description}` : '',
    recentCommits ? `Recent commits: ${recentCommits.split('\n').slice(0, 3).join(' | ')}` : '',
  ].filter(Boolean).join('\n')

  const personalityBlock = personality
    ? `${personality}\n\nYou are Astra. You run the Hermes Workspace Kanban. Respond in your voice — sharp, direct, decisive.`
    : 'You are Astra, Hermes Workspace AI. Sharp, direct, decisive. Never robotic.'

  let systemMsg: string
  let userMsg: string

  if (hasConversation) {
    // Continuation mode — Astra has already worked on this. She sees the thread and continues.
    systemMsg =
      personalityBlock + '\n\n' +
      'You are continuing work on a task. Respond conversationally in your own voice — ' +
      'acknowledge what Naveen said, then say what you\'re doing or finding. ' +
      'End with a WORK_SUMMARY block to update task status.'

    userMsg =
      taskLines + '\n\n' +
      '--- Conversation so far ---\n' +
      conversationContext + '\n' +
      '---\n\n' +
      'Continue from here. Reply in your voice, then end with:\n\n' +
      '<WORK_SUMMARY>\n' +
      'STATUS: partial\n' +
      'SUMMARY: [updated 1-2 sentence status]\n' +
      'NEXT: [next concrete action]\n' +
      'QUESTIONS: [{"id":"q1","q":"Which approach?","options":["Option A","Option B","Option C"]},{"id":"q2","q":"Free-form question?"}]\n' +
      '  — only if STATUS is needs_input; omit otherwise. Include "options" array (2-4 short choices) when answers are enumerable; omit "options" for open-ended questions.\n' +
      '</WORK_SUMMARY>\n\n' +
      'STATUS options: partial, done, blocked, needs_input\n' +
      'When needs_input: emit QUESTIONS (1-4). On resume, if answers satisfy all gaps, proceed.'
  } else {
    // Initial analysis mode
    systemMsg =
      personalityBlock + '\n\n' +
      'Analyze the task below. Reply ONLY with the WORK_SUMMARY block — nothing before or after it.'

    userMsg =
      taskLines + '\n\n' +
      '<WORK_SUMMARY>\n' +
      'STATUS: partial\n' +
      'SUMMARY: [1-2 sentences on what this involves and the approach]\n' +
      'CHANGES: [step 1; step 2; step 3]\n' +
      'NEXT: [single most important first action]\n' +
      'QUESTIONS: [{"id":"q1","q":"Which approach?","options":["Option A","Option B"]},{"id":"q2","q":"Open-ended question?"}]\n' +
      '  — only if STATUS is needs_input; omit otherwise. Include "options" (2-4 short choices) when enumerable; omit for open-ended.\n' +
      '</WORK_SUMMARY>\n\n' +
      'STATUS: partial | done | blocked | needs_input\n' +
      'When needs_input: emit QUESTIONS (1-4). On resume with answers, proceed.'
  }

  void (async () => {
    let output = ''
    let lastError = ''

    const msgs = [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg },
    ]

    // Primary: call OpenRouter directly (~1-2k tokens, fast).
    // Fallback: gateway openaiChat (88k token context, may timeout).
    const doDirectChat = (signal: AbortSignal) =>
      directChat(msgs, { max_tokens: 900, temperature: 0.4, signal })

    const doGatewayChat = (signal: AbortSignal) =>
      openaiChat(msgs, { max_tokens: 900, temperature: 0.4, signal })

    try {
      output = await doDirectChat(AbortSignal.timeout(30_000))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError = msg
      console.warn(`[executeTaskBackground] OpenRouter direct failed: ${msg} — trying gateway`)
      try {
        output = await doGatewayChat(AbortSignal.timeout(60_000))
      } catch {
        // Gateway also failed — retry direct as last resort
        try {
          output = await doDirectChat(AbortSignal.timeout(25_000))
        } catch (err3) {
          lastError = err3 instanceof Error ? err3.message : String(err3)
          console.error('[executeTaskBackground] all attempts failed:', lastError)
        }
      }
    }

    let status = 'partial'
    let summary = ''
    let changes = ''
    let next = ''
    let question = ''
    let clarificationQs: Array<{ id: string; q: string; options?: Array<string> }> = []

    // Parse WORK_SUMMARY block — accepts both wrapped (<WORK_SUMMARY>…</WORK_SUMMARY>)
    // and unwrapped (bare STATUS:/SUMMARY: lines) since some models drop the XML tags.
    const block = output.match(/<WORK_SUMMARY>([\s\S]*?)<\/WORK_SUMMARY>/)?.[1] ?? ''
    const freeText = output.replace(/<WORK_SUMMARY>[\s\S]*?<\/WORK_SUMMARY>/g, '').trim()

    // Parse from the XML block if present; otherwise fall back to the raw output
    const parseSource = block || (output.match(/^STATUS:/im) ? output : '')
    if (parseSource) {
      const smMatch = parseSource.match(/STATUS:\s*(\w+)/i)
      const suMatch = parseSource.match(/SUMMARY:\s*(.+)/i)
      const chMatch = parseSource.match(/CHANGES:\s*(.+)/i)
      const nxMatch = parseSource.match(/NEXT:\s*(.+)/i)
      if (smMatch) status = smMatch[1].toLowerCase()
      if (suMatch) summary = suMatch[1].trim().replace(/^\[|\]$/g, '')
      if (chMatch) changes = chMatch[1].trim().replace(/^\[|\]$/g, '')
      if (nxMatch) next = nxMatch[1].trim().replace(/^\[|\]$/g, '')
      // Parse structured QUESTIONS array first; fall back to legacy QUESTION: line
      const qsMatch = parseSource.match(/QUESTIONS:\s*(\[[\s\S]*?\])/i)
      if (qsMatch) {
        try { clarificationQs = JSON.parse(qsMatch[1]) as Array<{ id: string; q: string }> } catch { /* ignore */ }
      }
      if (clarificationQs.length === 0) {
        const qMatch = parseSource.match(/QUESTION:\s*(.+)/i)
        if (qMatch) {
          question = qMatch[1].trim().replace(/^\[|\]$/g, '')
          if (question) clarificationQs = [{ id: randomUUID(), q: question }]
        }
      }
    }

    // In continuation mode, the free text is Astra's conversational reply — use it as the note.
    // Also accept free-form output in initial mode when the model ignores the structured format.
    const rawOutputIsUsable = output.trim().length > 10 && !output.trim().startsWith('You are')
    const conversationalReply = (hasConversation || (!block && !parseSource)) && rawOutputIsUsable
      ? freeText || output.trim()
      : ''

    // Use conversational reply as primary note; fall back to SUMMARY from block;
    // last resort: first 400 chars of whatever the model returned
    const primaryNote = conversationalReply || summary ||
      (rawOutputIsUsable ? output.trim().slice(0, 400).replace(/\n{3,}/g, '\n\n') : '')

    if (!primaryNote) {
      const current = getTask(taskId)
      const existing = current?.agent_history ?? []
      const errorNote = lastError
        ? `AI unavailable: ${lastError.slice(0, 150)}. Try again or use Launch Session.`
        : 'AI analysis unavailable — please try again or use Launch Session.'
      updateTask(taskId, {
        agent_history: [...existing, {
          id: randomUUID(),
          by: displayName.toLowerCase(),
          byEmoji: emoji,
          action: 'blocked',
          note: errorNote,
          at: new Date().toISOString(),
        }],
        agent_state: null,
        agent_name: null,
        agent_action_at: null,
        waiting_for_user: false,
      })
      return
    }

    const current = getTask(taskId)
    const existing = current?.agent_history ?? []
    const freshColumn = current?.column ?? task.column

    const newColumn: TaskColumn =
      status === 'done' ? 'review' :
      status === 'blocked' ? 'blocked' :
      status === 'needs_input' ? 'blocked' :
      freshColumn

    if (status === 'needs_input' && (clarificationQs.length > 0 || conversationalReply)) {
      const now = new Date().toISOString()
      // Build a combined note from all questions for the activity feed
      const questionNote = clarificationQs.length > 0
        ? clarificationQs.map((q, i) => `Q${i + 1}: ${q.q}`).join('\n')
        : (conversationalReply || question)
      const questionsToSave = clarificationQs.map(q => ({
        id: q.id || randomUUID(),
        question: q.q,
        options: Array.isArray(q.options) && q.options.length > 0 ? q.options : undefined,
        asked_at: now,
      }))
      updateTask(taskId, {
        agent_comment: questionNote,
        clarification_questions: questionsToSave.length > 0 ? questionsToSave : undefined,
        agent_history: [...existing, {
          id: randomUUID(),
          by: displayName.toLowerCase(),
          byEmoji: emoji,
          action: 'question',
          note: questionNote,
          at: now,
        }],
        agent_state: 'waiting_for_input',
        agent_name: displayName.toLowerCase(),
        agent_action_at: now,
        waiting_for_user: true,
        column: newColumn,
      })
      if (questionsToSave.length > 0) {
        const tgPointer = await sendTelegramClarification(
          { id: taskId, title: task.title },
          questionsToSave,
        )
        if (tgPointer) {
          updateTask(taskId, { clarify_tg: tgPointer })
        }
      }
      return
    }

    // Build the activity entry note
    const parts = [primaryNote]
    if (!conversationalReply) {
      if (changes && changes !== '...') parts.push('Steps: ' + changes)
      if (next && next !== '...') parts.push('Next: ' + next)
    } else if (next && next !== '...') {
      parts.push('→ ' + next)
    }
    const note = parts.join('\n\n')

    const actionLabel = status === 'done' ? 'completed' : status === 'blocked' ? 'blocked' : hasConversation ? 'replied' : 'analyzed'

    const entry: ActivityEntry = {
      id: randomUUID(),
      by: displayName.toLowerCase(),
      byEmoji: emoji,
      action: actionLabel,
      note: note || 'Task analyzed.',
      at: new Date().toISOString(),
    }

    updateTask(taskId, {
      agent_comment: primaryNote || entry.note,
      agent_history: [...existing, entry],
      agent_state: null,
      agent_name: null,
      agent_action_at: null,
      waiting_for_user: false,
      column: newColumn,
    })

    // Send Telegram notification for terminal outcomes (done / blocked)
    if (status === 'done' || status === 'blocked') {
      void sendTelegramTaskDone({ id: taskId, title: task.title }, status, note)
    }
  })()
}

// ---------------------------------------------------------------------------
// executeTaskWithHermesBackground — full autonomous execution via hermes -z
//
// Unlike executeTaskBackground (which calls OpenRouter directly with no tools),
// this spawns hermes -z in a detached subprocess. hermes -z loads the full
// toolset (file, terminal, memory) and runs its own agent loop (up to
// max_turns) — so Astra can actually write files, run commands, and iterate
// until the task is done or blocked, with no TypeScript loop needed.
//
// Fixes applied over the initial version:
//   #1 log file  — redirects all output to ~/.hermes/logs/exec-<id>-<ts>.log
//   #2 try/finally — agent_state is always cleared, even on crash or timeout
//   #3 non-zero exit — maps to blocked instead of silent partial
//   #4 timeout  — raised to 20 min; --accept-hooks added to bypass prompts
//   #5 cleanup  — temp .mjs script deleted after the run
//   #6 persona  — SOUL.md prepended so hermes knows it's Astra
//   #7 label    — partial-with-no-summary → 'attempted', not 'replied'
//
// Called by the Execute button; executeTaskBackground is kept for the lighter
// "user replied" conversational-continuation path.
// ---------------------------------------------------------------------------

export function executeTaskWithHermesBackground(taskId: string): void {
  const task = getTask(taskId)
  if (!task) return

  const { workCwd, profileDir, displayName, emoji } = resolveSisterAndCwd(task)
  const hermesHome =
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
  const tasksFilePath = path.join(hermesHome, 'tasks.json')

  // #6: prepend SOUL.md personality; use sister's profile if one is assigned
  const personality = loadAstraPersonality()

  // Build history context (last 6 entries) so Astra sees what was already tried
  const history = task.agent_history ?? []
  const priorContext = history
    .filter(e => e.action !== 'executed')
    .slice(-6)
    .map(e => {
      const who = e.by === 'user' ? 'Naveen' : `Astra (${e.action})`
      return `[${who}] ${e.note.slice(0, 300)}`
    })
    .join('\n')

  const isReopen = (task.agent_history ?? []).some(
    e => e.by === 'user' && e.action === 'replied'
  ) && (task.agent_history ?? []).some(
    e => e.by !== 'user' && e.action === 'completed'
  )

  const prompt = [
    personality,
    '',
    'You are Astra, an autonomous AI agent. Implement this task completely using your file and terminal tools.',
    'Do NOT just describe a plan — actually write the files, run the commands, verify the result.',
    '',
    isReopen
      ? 'IMPORTANT: Naveen has reviewed prior work and flagged an issue. Read the prior context carefully, understand what went wrong or was not found, then fix or redo it.'
      : '',
    'IMPORTANT: If you check and find the work is already complete and working, report STATUS: done with SUMMARY describing exactly what you found (file path, function name, URL, etc.). Do not re-implement something that already exists.',
    '',
    `Task: ${task.title}`,
    task.description ? `Description: ${task.description}` : '',
    task.tags.length ? `Tags: ${task.tags.join(', ')}` : '',
    priorContext ? `\nPrior work on this task:\n${priorContext}` : '',
    '',
    "When you finish (or hit a genuine blocker requiring Naveen's input), end your final message with:",
    '',
    '<WORK_SUMMARY>',
    'STATUS: done|blocked|needs_input',
    'SUMMARY: [what was built / changed, or what already existed and where]',
    'NEXT: [leave blank if done, or what remains]',
    'QUESTIONS: [{"id":"q1","q":"Which approach?","options":["Option A","Option B","Option C"]},{"id":"q2","q":"Open question?"}]',
    '  — only if STATUS is needs_input; omit otherwise. Add "options" array (2-4 short choices) when answers are enumerable.',
    '</WORK_SUMMARY>',
    'When needs_input: emit QUESTIONS (1-4). On resume with answers, satisfy gaps and proceed.',
  ].filter(Boolean).join('\n')

  // Generate paths before building script content so they can be embedded as constants
  const timestamp = Date.now()
  const scriptPath = path.join(os.tmpdir(), `hermes-exec-${timestamp}.mjs`)
  const logsDir = path.join(hermesHome, 'logs')
  const logPath = path.join(logsDir, `exec-${taskId.slice(0, 8)}-${timestamp}.log`)

  // #1: ensure logs dir exists before the child tries to write to it
  fs.mkdirSync(logsDir, { recursive: true })

  const scriptContent = `
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const TASKS_FILE       = ${JSON.stringify(tasksFilePath)};
const HERMES_BIN       = ${JSON.stringify(HERMES_BIN)};
const TASK_ID          = ${JSON.stringify(taskId)};
const TASK_TITLE       = ${JSON.stringify(task.title)};
const DISPLAY_NAME     = ${JSON.stringify(displayName || 'Astra')};
const BY_EMOJI         = ${JSON.stringify(emoji || '🌟')};
const PROFILE_DIR      = ${JSON.stringify(profileDir || '')};
const WORK_CWD         = ${JSON.stringify(workCwd)};
const PROMPT           = ${JSON.stringify(prompt)};
const LOG_PATH         = ${JSON.stringify(logPath)};
const SCRIPT_PATH      = ${JSON.stringify(scriptPath)};
const TG_TARGET        = 'telegram:2130622225';
const AUTO_RETRY_COUNT = ${task.auto_retry_count ?? 0};
// On retry ≥1, switch to a configurable fallback model. Default stays on a free
// OpenRouter tier; operators can opt into a paid model via environment when needed.
const RETRY_MODEL = process.env.HERMES_TASK_RETRY_MODEL || 'openrouter/owl-alpha';
const RETRY_PROVIDER = process.env.HERMES_TASK_RETRY_PROVIDER || 'openrouter';
const RETRY_MODEL_ARGS = AUTO_RETRY_COUNT >= 1
  ? ['-m', RETRY_MODEL, '--provider', RETRY_PROVIDER]
  : [];

const LOCK_FILE = TASKS_FILE + '.lock';

// #1: append-only log helper — all hermes output lands here
function log(msg) {
  try { fs.appendFileSync(LOG_PATH, '[' + new Date().toISOString() + '] ' + msg + '\\n', 'utf-8'); } catch {}
}

function sleep(ms) { const end = Date.now() + ms; while (Date.now() < end) {} }

// Cross-process advisory lock — prevents concurrent writes from this script
// and the SSR server clobbering each other's updates to tasks.json.
function withTasksLock(fn) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(LOCK_FILE, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
      fs.closeSync(fd);
      try { return fn(); } finally { try { fs.unlinkSync(LOCK_FILE); } catch {} }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { const s = fs.statSync(LOCK_FILE); if (Date.now() - s.mtimeMs > 30_000) { fs.unlinkSync(LOCK_FILE); continue; } } catch {}
      sleep(50);
    }
  }
  return fn();
}

function readTasks() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8').trim();
    if (!raw) return { tasks: [] };
    const parsed = JSON.parse(raw);
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch (e) { log('readTasks error: ' + e); return { tasks: [] }; }
}

function writeTasks(data) {
  const content = JSON.stringify(data, null, 2) + '\\n';
  const tmp = TASKS_FILE + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, TASKS_FILE);
}

function updateTaskDirect(id, updates) {
  withTasksLock(() => {
    const file = readTasks();
    const idx = file.tasks.findIndex(t => t.id === id);
    if (idx === -1) { log('updateTaskDirect: task not found: ' + id); return; }
    file.tasks[idx] = { ...file.tasks[idx], ...updates, updated_at: new Date().toISOString() };
    writeTasks(file);
  });
}

// Load Telegram bot token from ~/.hermes/.env
function loadTgToken() {
  try {
    const envPath = path.join(os.homedir(), '.hermes', '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch { return ''; }
}

const TG_RELAY_BASE = 'https://tg-api.fernandofamily.com/8c778d763c97aa414644fc5bd95da90a';
const TG_CHAT_ID = 2130622225;

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Send clarification keyboard (inline buttons for structured Q&A)
async function sendTelegramClarificationKeyboard(taskId, taskTitle, questions) {
  const token = loadTgToken();
  if (!token) { spawnSync(HERMES_BIN, ['send', '--to', TG_TARGET, '-q', '\\u2753 Clarification needed\\nTask: ' + taskTitle], { encoding: 'utf-8', timeout: 15_000 }); return; }
  const taskPrefix = taskId.replace(/-/g, '').slice(0, 12);
  let text = '\\u2753 <b>Clarification needed</b>\\n<b>Task:</b> ' + escHtml(taskTitle) + '\\n\\n';
  const keyboard = [];
  const pendingApp = [];
  questions.forEach(function(q, qi) {
    text += '<b>Q' + (qi + 1) + '.</b> ' + escHtml(q.question) + '\\n';
    if (q.options && q.options.length > 0) {
      const row = q.options.map(function(opt, oi) {
        return { text: opt, callback_data: 'task:' + taskPrefix + ':' + qi + ':' + oi };
      });
      row.push({ text: '\\u270f\\ufe0f Custom', url: 'https://agent.fernandofamily.com/tasks?task=' + taskId });
      keyboard.push(row);
    } else {
      pendingApp.push('Q' + (qi + 1));
    }
  });
  if (pendingApp.length > 0) {
    text += '\\n<i>' + pendingApp.join(', ') + ': reply to this message with your answer.</i>\\n';
    keyboard.push([{ text: '\\U0001f517 Open task', url: 'https://agent.fernandofamily.com/tasks?task=' + taskId }]);
  }
  try {
    const res = await fetch(TG_RELAY_BASE + '/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }),
    });
    const data = await res.json();
    if (data.ok && data.result && data.result.message_id) {
      updateTaskDirect(taskId, { clarify_tg: { chat_id: TG_CHAT_ID, message_id: data.result.message_id } });
    }
  } catch (e) {
    log('sendTelegramClarificationKeyboard failed: ' + e);
  }
}

// Send task-done / task-blocked notification with a deep-link button
async function sendTelegramDoneNotification(taskId, taskTitle, status, note) {
  const token = loadTgToken();
  const header = status === 'done' ? '\\u2705 <b>Task completed</b>' : status === 'blocked' ? '\\U0001f6ab <b>Task blocked</b>' : '\\u23f3 <b>Task update</b>';
  const text = header + '\\n<b>Task:</b> ' + escHtml(taskTitle) + '\\n\\n' + escHtml(String(note).slice(0, 400));
  const keyboard = [[{ text: '\\U0001f517 Open task', url: 'https://agent.fernandofamily.com/tasks?task=' + taskId }]];
  if (token) {
    try {
      await fetch(TG_RELAY_BASE + '/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }),
      });
      return;
    } catch (e) { log('sendTelegramDoneNotification fetch failed: ' + e); }
  }
  // Fallback: plain text via hermes send
  const statusEmoji = status === 'done' ? '\\u2705' : status === 'blocked' ? '\\U0001f6ab' : '\\u23f3';
  spawnSync(HERMES_BIN, ['send', '--to', TG_TARGET, '-q', statusEmoji + ' ' + BY_EMOJI + ' ' + DISPLAY_NAME + ' \\u2014 ' + status + '\\nTask: ' + taskTitle + '\\n' + String(note).slice(0, 300)], { encoding: 'utf-8', timeout: 15_000 });
}

// Clean up orphaned hermes-exec-*.mjs scripts from previous killed runs.
try {
  const tmpDir = os.tmpdir();
  const staleMs = 30 * 60 * 1000; // 30 min
  for (const f of fs.readdirSync(tmpDir)) {
    if (!f.startsWith('hermes-exec-') || !f.endsWith('.mjs')) continue;
    const full = tmpDir + '/' + f;
    try {
      const stat = fs.statSync(full);
      if (Date.now() - stat.mtimeMs > staleMs) fs.unlinkSync(full);
    } catch {}
  }
} catch {}

// #2: always clear the spinner, even if we crash or time out
function clearAgentState() {
  try {
    updateTaskDirect(TASK_ID, { agent_state: null, agent_name: null, agent_action_at: null });
    log('agent state cleared');
  } catch (e) { log('clearAgentState error: ' + e); }
}

// #5: delete the temp script file after the run
function cleanup() {
  try { fs.unlinkSync(SCRIPT_PATH); } catch {}
}

log('starting hermes execution — cwd=' + WORK_CWD);

let result;
try {
  // #1 sister routing: pass --profile when a specific sister is assigned
  const profileArgs = PROFILE_DIR ? ['--profile', PROFILE_DIR] : [];
  log('profile=' + (PROFILE_DIR || 'default') + ' sister=' + DISPLAY_NAME);

  // #4: 20-min timeout; --accept-hooks bypasses hook confirmation prompts
  // RETRY_MODEL_ARGS overrides the default model on retries (more reliable provider)
  result = spawnSync(HERMES_BIN, [...profileArgs, ...RETRY_MODEL_ARGS, '-z', PROMPT, '--accept-hooks'], {
    encoding: 'utf-8',
    timeout: 1_200_000,
    maxBuffer: 8 * 1024 * 1024,
    cwd: WORK_CWD,
  });
  log('hermes finished — exit=' + result.status + ' stdout_len=' + (result.stdout || '').length + (RETRY_MODEL_ARGS.length ? ' [retry-model]' : ''));
} catch (e) {
  // spawnSync throws on timeout (ETIMEDOUT) or spawn failure
  log('spawnSync threw: ' + e);
  clearAgentState();
  cleanup();
  process.exit(1);
}

const output = (result.stdout || '').trim();
const stderr  = (result.stderr  || '').trim();
if (stderr)  log('stderr tail: ' + stderr.slice(-400));
if (output)  log('stdout tail: ' + output.slice(-400));

// Parse WORK_SUMMARY block
let status           = 'partial';
let summary          = '';
let next             = '';
let question         = '';
let clarificationQs  = [];

const block = output.match(/<WORK_SUMMARY>([\\s\\S]*?)<\\/WORK_SUMMARY>/)?.[1] ?? '';
const parseSource = block || (output.match(/^STATUS:/im) ? output : '');
if (parseSource) {
  const smMatch = parseSource.match(/STATUS:\\s*(\\w+)/i);
  const suMatch = parseSource.match(/SUMMARY:\\s*(.+)/i);
  const nxMatch = parseSource.match(/NEXT:\\s*(.+)/i);
  if (smMatch) status  = smMatch[1].toLowerCase();
  if (suMatch) summary = suMatch[1].trim().replace(/^\\[|\\]$/g, '');
  if (nxMatch) next    = nxMatch[1].trim().replace(/^\\[|\\]$/g, '');
  // Parse structured QUESTIONS array (new format); fall back to legacy QUESTION: line
  const qsMatch = parseSource.match(/QUESTIONS:\\s*(\\[[\\s\\S]*?\\])/i);
  if (qsMatch) {
    try { clarificationQs = JSON.parse(qsMatch[1]); } catch(e) { log('QUESTIONS parse error: ' + e); }
  }
  if (clarificationQs.length === 0) {
    const qMatch = parseSource.match(/QUESTION:\\s*(.+)/i);
    if (qMatch) {
      question = qMatch[1].trim().replace(/^\\[|\\]$/g, '');
      if (question) clarificationQs = [{id: 'q' + Math.random().toString(36).slice(2,6), q: question}];
    }
  }
}

// #3: non-zero exit → blocked only for genuine agent failures; transient model errors stay partial
const isTransientFailure = stderr.includes('no final response') || stderr.includes('timed out') || stderr.includes('connection refused') || stderr.includes('rate limit');
if (result.status !== 0 && status === 'partial' && !isTransientFailure) {
  status  = 'blocked';
  summary = summary || ('hermes exited with code ' + result.status + (stderr ? ': ' + stderr.slice(0, 200) : ''));
} else if (result.status !== 0 && status === 'partial' && isTransientFailure) {
  summary = summary || ('Transient execution failure (model unavailable) — will retry automatically. ' + stderr.slice(0, 150));
}

const freeText = output.replace(/<WORK_SUMMARY>[\\s\\S]*?<\\/WORK_SUMMARY>/g, '').trim();
const note = summary || freeText.slice(0, 800) ||
  (result.status !== 0
    ? 'Execution failed (exit ' + result.status + '): ' + stderr.slice(0, 200)
    : 'Task executed — no summary returned.');

const parts = [note];
if (next && next !== '...') parts.push('→ ' + next);
const fullNote = parts.join('\\n\\n');

// #7: partial-with-no-WORK_SUMMARY → 'attempted', not 'replied'
const actionLabel =
  status === 'done'        ? 'completed' :
  status === 'blocked'     ? 'blocked'   :
  status === 'needs_input' ? 'question'  : 'attempted';

const newColumn =
  status === 'done'        ? 'review'  :
  status === 'blocked'     ? 'blocked' :
  status === 'needs_input' ? 'blocked' : null;

log('resolved — status=' + status + ' action=' + actionLabel + ' column=' + (newColumn || 'unchanged'));

const file    = readTasks();
const taskRec = file.tasks.find(t => t.id === TASK_ID);
if (!taskRec) {
  log('task not found in tasks.json at update time');
  cleanup();
  process.exit(0);
}

// Build the history entry note — for needs_input, list questions so history is readable
const questionNote = clarificationQs.length > 0
  ? clarificationQs.map((q, i) => 'Q' + (i+1) + ': ' + (q.q || q.question || '')).join('\\n')
  : (question || note);
const entryNote = status === 'needs_input' ? questionNote : fullNote;

// Build clarification_questions for the task record
const questionsToSave = clarificationQs
  .map(q => ({
    id: q.id || ('q' + Math.random().toString(36).slice(2,6)),
    question: q.q || q.question || '',
    options: Array.isArray(q.options) && q.options.length > 0 ? q.options : undefined,
    asked_at: new Date().toISOString(),
  }))
  .filter(q => q.question);

const existing = Array.isArray(taskRec.agent_history) ? taskRec.agent_history : [];
const entry = {
  id:      randomUUID(),
  by:      DISPLAY_NAME.toLowerCase(),
  byEmoji: BY_EMOJI,
  action:  actionLabel,
  note:    entryNote,
  at:      new Date().toISOString(),
};

updateTaskDirect(TASK_ID, {
  agent_comment:    note,
  agent_history:    [...existing, entry],
  agent_state:      status === 'needs_input' ? 'waiting_for_input' : null,
  agent_name:       status === 'needs_input' ? DISPLAY_NAME.toLowerCase() : null,
  agent_action_at:  status === 'needs_input' ? new Date().toISOString() : null,
  waiting_for_user: status === 'needs_input',
  ...(questionsToSave.length > 0 && status === 'needs_input' ? { clarification_questions: questionsToSave } : {}),
  ...(newColumn ? { column: newColumn } : {}),
});

log('task updated successfully');

// Telegram notification — rich card for terminal outcomes; keyboard for clarifications
try {
  if (status === 'needs_input' && questionsToSave.length > 0) {
    await sendTelegramClarificationKeyboard(TASK_ID, TASK_TITLE, questionsToSave);
    log('telegram clarification keyboard sent');
  } else if (status === 'done' || status === 'blocked') {
    await sendTelegramDoneNotification(TASK_ID, TASK_TITLE, status, note);
    log('telegram done notification sent');
  }
  // partial/attempted: no notification (intermediate state, not worth pinging)
} catch (e) {
  log('telegram notification failed (non-fatal): ' + e);
}

cleanup();
`

  fs.writeFileSync(scriptPath, scriptContent, 'utf-8')

  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    cwd: workCwd,
  })
  child.unref()
}

// ---------------------------------------------------------------------------
// generateTaskFromText — convert plain-language description to task fields
// ---------------------------------------------------------------------------

export type GeneratedTaskFields = {
  title: string
  description: string
  column: TaskColumn
  priority: TaskPriority
  assignee: string | null
  tags: Array<string>
}

export async function generateTaskFromText(text: string): Promise<GeneratedTaskFields | null> {
  const prompt =
    'You are converting a natural-language task description into a structured task for the Hermes Workspace Kanban board.\n\n' +
    'Available assignees: orchestrator, builder, researcher, reviewer, qa, ops-watch, maintainer, ada, maya, luna, nova, novus, astra\n\n' +
    'Columns: backlog (not started / unclear), todo (ready to work now), in_progress (actively started)\n\n' +
    'User input: ' + JSON.stringify(text) + '\n\n' +
    'Return ONLY valid JSON — no other text:\n' +
    '{\n' +
    '  "title": "Short action-oriented title (max 70 chars)",\n' +
    '  "description": "2-3 sentences expanding on what needs to be done and why",\n' +
    '  "column": "backlog",\n' +
    '  "priority": "high|medium|low",\n' +
    '  "assignee": "best match from the list above, or null",\n' +
    '  "tags": ["tag1", "tag2"]\n' +
    '}'

  let raw = ''
  try {
    raw = await openaiChat(
      [{ role: 'user', content: prompt }],
      { max_tokens: 600, temperature: 0.3 },
    )
  } catch {
    return null
  }

  if (!raw.trim()) return null
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* skip */ }
    }
  }

  if (!parsed || typeof parsed !== 'object') return null

  const p = parsed as Record<string, unknown>
  const title = typeof p.title === 'string' ? p.title.trim() : ''
  if (!title) return null

  const VALID_COLUMNS: Array<TaskColumn> = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done']
  const VALID_PRIORITIES: Array<TaskPriority> = ['high', 'medium', 'low']

  return {
    title,
    description: typeof p.description === 'string' ? p.description.trim() : '',
    column: VALID_COLUMNS.includes(p.column as TaskColumn) ? (p.column as TaskColumn) : 'backlog',
    priority: VALID_PRIORITIES.includes(p.priority as TaskPriority) ? (p.priority as TaskPriority) : 'medium',
    assignee: typeof p.assignee === 'string' && p.assignee ? p.assignee : null,
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
  }
}

// ---------------------------------------------------------------------------
// breakdownTaskWithAI — split a complex task into concrete subtasks
// ---------------------------------------------------------------------------

export async function breakdownTaskWithAI(taskId: string): Promise<{ count: number; titles: Array<string> } | null> {
  const task = getTask(taskId)
  if (!task) return null

  const prompt =
    'You are breaking down a high-level task into concrete subtasks for the Hermes Workspace Kanban board.\n\n' +
    'Parent task:\n' +
    'Title: ' + task.title + '\n' +
    'Description: ' + (task.description || '(none)') + '\n' +
    'Priority: ' + task.priority + ' | Tags: ' + (task.tags.join(', ') || 'none') + ' | Assignee: ' + (task.assignee || 'none') + '\n\n' +
    'Generate 3-6 subtasks that together complete this parent task. Each subtask must:\n' +
    '- Be completable in one focused work session (1-4 hours)\n' +
    '- Be concrete and actionable\n' +
    '- Have a clear definition of done\n\n' +
    'Return ONLY a valid JSON array, no other text:\n' +
    '[\n' +
    '  {\n' +
    '    "title": "Short action-oriented title (max 70 chars)",\n' +
    '    "description": "What to do and what done looks like. Part of: ' + task.title + '",\n' +
    '    "priority": "high|medium|low",\n' +
    '    "assignee": "' + (task.assignee || 'null') + ' or more specific sister",\n' +
    '    "tags": ["subtask", "relevant-tag"]\n' +
    '  }\n' +
    ']'

  let raw = ''
  try {
    raw = await openaiChat(
      [{ role: 'user', content: prompt }],
      { max_tokens: 1200, temperature: 0.3 },
    )
  } catch {
    return null
  }

  if (!raw.trim()) return null
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* skip */ }
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const VALID_PRIORITIES: Array<TaskPriority> = ['high', 'medium', 'low']
  const subtasks = (parsed as Array<Record<string, unknown>>).filter(s => typeof s.title === 'string' && s.title)

  if (subtasks.length === 0) return null

  const MAX_SUBTASKS_TS = 6
  const allExisting = listTasks({ includeDone: false })
  const existingTitlesSet = new Set(allExisting.map((t) => t.title.toLowerCase().trim()))

  const titles: Array<string> = []

  for (const sub of subtasks) {
    if (titles.length >= MAX_SUBTASKS_TS) break
    const normalized = (sub.title as string).trim().toLowerCase()
    if (existingTitlesSet.has(normalized)) continue

    const subTags = Array.isArray(sub.tags)
      ? (sub.tags as Array<string>).filter(t => typeof t === 'string').slice(0, 4)
      : ['subtask', ...task.tags.slice(0, 2)]

    if (!subTags.includes('subtask')) subTags.unshift('subtask')

    createTask({
      title: (sub.title as string).trim(),
      description: typeof sub.description === 'string' ? sub.description.trim() : '',
      column: 'backlog',
      priority: VALID_PRIORITIES.includes(sub.priority as TaskPriority) ? (sub.priority as TaskPriority) : task.priority,
      assignee: typeof sub.assignee === 'string' && sub.assignee && sub.assignee !== 'null' ? sub.assignee : task.assignee ?? null,
      tags: subTags,
      source: 'astra',
    })

    titles.push((sub.title as string).trim())
    existingTitlesSet.add(normalized)
  }

  const count = titles.length
  const note = `Split into ${count} subtask${count !== 1 ? 's' : ''}: ${titles.slice(0, 3).join(', ')}${count > 3 ? '…' : ''}`
  const entry: ActivityEntry = {
    id: randomUUID(),
    by: 'astra',
    byEmoji: '🌟',
    action: 'broke down',
    note,
    at: new Date().toISOString(),
  }

  updateTask(taskId, {
    agent_comment: note,
    agent_history: [...(task.agent_history ?? []), entry],
  })

  return { count, titles }
}

// ---------------------------------------------------------------------------
// injectIdeasAsBacklog
// ---------------------------------------------------------------------------

type IdeaEntry = {
  title: string
  description?: string
  category?: string
  estimated_effort?: string
}

// IDEAS.json lives in the repo root. The server always runs from the repo root
// (WorkingDirectory in the systemd unit), so process.cwd() is reliable.
// Override with HERMES_WORKSPACE_IDEAS_FILE if needed.
const IDEAS_FILE =
  process.env.HERMES_WORKSPACE_IDEAS_FILE ??
  path.join(process.cwd(), 'IDEAS.json')

export function injectIdeasAsBacklog(): { injected: number; ideas: Array<string> } {
  let ideas: Array<IdeaEntry> = []
  try {
    const raw = fs.readFileSync(IDEAS_FILE, 'utf-8').trim()
    const parsed = JSON.parse(raw) as unknown
    ideas = Array.isArray(parsed) ? (parsed as Array<IdeaEntry>) : []
  } catch {
    return { injected: 0, ideas: [] }
  }

  if (ideas.length === 0) return { injected: 0, ideas: [] }

  // Get existing task titles (case-insensitive) to avoid duplicates
  const allTasks = listTasks({ includeDone: true })
  const existingTitles = new Set(allTasks.map((t) => t.title.toLowerCase()))

  const injectedTitles: Array<string> = []

  for (const idea of ideas) {
    if (!idea.title) continue
    if (existingTitles.has(idea.title.toLowerCase())) continue

    const effortToPriority = (effort: string | undefined) => {
      if (effort === 'high') return 'high' as const
      if (effort === 'low') return 'low' as const
      return 'medium' as const
    }

    createTask({
      title: idea.title,
      description: idea.description ?? '',
      column: 'backlog',
      priority: effortToPriority(idea.estimated_effort),
      tags: [idea.category ?? 'idea'],
      created_by: 'idea_job',
      source: 'idea_job',
    })

    injectedTitles.push(idea.title)
    existingTitles.add(idea.title.toLowerCase())
  }

  return { injected: injectedTitles.length, ideas: injectedTitles }
}

// ---------------------------------------------------------------------------
// generateIdeasWithAI
// ---------------------------------------------------------------------------

export function generateIdeasWithAI(): { injected: number; ideas: Array<string>; error?: string } {
  const hermesHome =
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')

  // ── 1. Gather workspace context ─────────────────────────────────────────
  const allTasks = listTasks({ includeDone: true })
  const existingTaskTitles = allTasks.map((t) => t.title).slice(0, 50)

  let existingIdeas: Array<IdeaEntry> = []
  try {
    const raw = fs.readFileSync(IDEAS_FILE, 'utf-8').trim()
    const parsed = JSON.parse(raw) as unknown
    existingIdeas = Array.isArray(parsed) ? (parsed as Array<IdeaEntry>) : []
  } catch { /* ok if file doesn't exist */ }

  const allSkipTitles = [
    ...existingTaskTitles,
    ...existingIdeas.map((e) => e.title),
  ]

  // Recent git commits — gives the AI a sense of what's been worked on
  let recentCommits = 'No git history available'
  try {
    const r = spawnSync('git', ['log', '--oneline', '-10'], {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 5000,
    })
    if (r.stdout.trim()) recentCommits = r.stdout.trim()
  } catch { /* ok */ }

  // App screen list from routes — gives AI a clear map of what exists
  let screenList = ''
  try {
    const r = spawnSync(
      'find',
      ['src/routes', '-name', 'index.tsx', '-not', '-path', '*/api/*'],
      { encoding: 'utf-8', cwd: process.cwd(), timeout: 5000 },
    )
    if (r.stdout.trim()) {
      screenList = r.stdout
        .trim()
        .split('\n')
        .map((p) => p.replace('src/routes/', '').replace('/index.tsx', '') || '/')
        .join(', ')
    }
  } catch { /* ok */ }

  // Top-level src/screens dirs — understand what features exist
  let screenDirs = ''
  try {
    const r = spawnSync('find', ['src/screens', '-maxdepth', '1', '-mindepth', '1', '-type', 'd'], {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 5000,
    })
    if (r.stdout.trim()) {
      screenDirs = r.stdout
        .trim()
        .split('\n')
        .map((p) => path.basename(p))
        .join(', ')
    }
  } catch { /* ok */ }

  // VM-level: list home dir projects for broader context
  let vmProjects = ''
  try {
    const r = spawnSync('find', ['/srv/projects', '-maxdepth', '1', '-mindepth', '1', '-type', 'd'], {
      encoding: 'utf-8',
      timeout: 5000,
    })
    if (r.stdout.trim()) {
      vmProjects = r.stdout
        .trim()
        .split('\n')
        .map((p) => path.basename(p))
        .join(', ')
    }
  } catch { /* ok */ }

  // Hermes sister agents — the AI should know who's available
  let sisterNames = 'Astra, Novus, Nova, Luna, Ada, Maya, Helena, Larissa, Clara, Bia, Vitória, Daiane'
  try {
    const sistersYaml = fs.readFileSync(
      path.join(hermesHome, 'config', 'sisters.yaml'),
      'utf-8',
    )
    const names = [...sistersYaml.matchAll(/^ {2}name:\s+"?([^"\n]+)"?/gm)].map((m) => m[1])
    if (names.length > 0) sisterNames = names.join(', ')
  } catch { /* ok */ }

  // ── 2. Build prompt ──────────────────────────────────────────────────────
  const prompt = `You are Astra, scanning the Hermes Workspace to suggest genuinely useful feature ideas for the operator Naveen.

## About the workspace
Hermes Workspace is a personal AI agent orchestration platform — a full-stack TypeScript webapp (TanStack Start + React + Vite + pnpm) running on an OCI ARM64 VM. It provides:
- Dashboard: AI agent activity monitoring, analytics, cost tracking, model usage
- Chat: multi-model chat via OpenRouter gateway
- Operations: manage AI sisters (named agents) — ${sisterNames}
- Swarm: parallel multi-agent sessions
- Tasks: Kanban board with Astra AI review
- Profiles: SOUL.md personality management
- Skills: tool/skill management
- Terminal: browser-based shell
- Memory/Knowledge: agent memory browser

## App screens
${screenDirs || screenList || '(not available)'}

## Recent git commits
${recentCommits}

## VM projects (context for what else Naveen is working on)
${vmProjects || '(not available)'}

## Existing tasks and ideas to SKIP (do not suggest these again)
${allSkipTitles.length > 0 ? allSkipTitles.map((t) => `- ${t}`).join('\n') : '(none yet)'}

## Your task
Suggest 6-8 specific, actionable improvements or new features. Focus on:
- UI/UX improvements to existing screens that would visibly improve daily operator experience
- AI-powered automations that use the existing sisters/HARP routing
- Cost-reduction features (smarter model routing, caching, budget alerts)
- Integration ideas (e.g. Telegram bot commands, webhook triggers, cron job improvements)
- Features that make the AI sisters feel more alive (personality, memory, proactive nudges)
- Developer productivity features for Naveen's VM workflow

Each idea must be:
- Specific enough to start coding immediately (not "improve performance")
- Realistically completable in 1–3 days of focused work
- Different from the skip list above

Return ONLY a valid JSON array, no explanation before or after:
[
  {
    "title": "Short action-oriented title (max 60 chars)",
    "description": "2-3 sentences: what it does and why it is useful",
    "category": "ui|ai|integration|analytics|devex|storage|performance",
    "estimated_effort": "low|medium|high"
  }
]`

  // ── 3. Call AI via Hermes CLI ────────────────────────────────────────────
  const result = spawnSync(HERMES_BIN, ['-z', prompt], {
    encoding: 'utf-8',
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  })

  if (result.status !== 0 || !result.stdout.trim()) {
    return { injected: 0, ideas: [], error: 'AI call failed or returned empty' }
  }

  // ── 4. Parse JSON from response ──────────────────────────────────────────
  let generated: Array<IdeaEntry> = []
  try {
    const text = result.stdout.trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Find first [...] block in case the model added surrounding text
      const match = text.match(/\[\s*\{[\s\S]*?\}\s*\]/)
      if (match) parsed = JSON.parse(match[0])
    }
    if (Array.isArray(parsed)) {
      generated = (parsed as Array<IdeaEntry>).filter(
        (e) => typeof e.title === 'string' && Boolean(e.title.trim()),
      )
    }
  } catch {
    return { injected: 0, ideas: [], error: 'Could not parse AI response' }
  }

  if (generated.length === 0) {
    return { injected: 0, ideas: [], error: 'AI returned no parseable ideas' }
  }

  // ── 5. Merge into IDEAS.json ─────────────────────────────────────────────
  const existingSet = new Set(existingIdeas.map((e) => e.title.toLowerCase()))
  const toAppend = generated.filter((e) => !existingSet.has(e.title.toLowerCase()))
  const merged = [...existingIdeas, ...toAppend]

  try {
    fs.writeFileSync(IDEAS_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
  } catch { /* non-fatal — still inject what we have */ }

  // ── 6. Inject into backlog (deduplication vs existing tasks handled inside) ──
  return injectIdeasAsBacklog()
}

// ---------------------------------------------------------------------------
// runCompletionCheckBackground — Astra verifies review/in_progress tasks and
// moves confirmed-done ones to 'done'.
//
// For each candidate task, the script:
//   1. Gathers recent git commits and service status as evidence
//   2. Asks Astra (via OpenRouter direct): "Is this task done and deployed?"
//   3. If confident YES → moves to 'done' + Telegram notification
//   4. If uncertain / NO → leaves the column unchanged
// ---------------------------------------------------------------------------

export function runCompletionCheckBackground(): { taskCount: number } {
  const nowMs = Date.now()
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000

  const candidates = [
    ...listTasks({ column: 'review' }),
    ...listTasks({ column: 'in_progress' }),
  ].filter((t) => {
    if (t.agent_state) return false
    // Skip tasks checked recently to avoid spam — one check per 3 hours per task
    const lastChecked = (t.agent_history ?? []).slice().reverse().find((e) => e.action === 'checked')
    if (lastChecked && nowMs - new Date(lastChecked.at).getTime() < THREE_HOURS_MS) return false
    return true
  })

  if (candidates.length === 0) return { taskCount: 0 }

  // Mark all as reviewing so the UI shows spinners immediately
  markTasksAsReviewing(candidates.map((t) => t.id))

  const hermesHome =
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
  const tasksFilePath = path.join(hermesHome, 'tasks.json')

  let serviceStatus = ''
  try {
    const r = spawnSync('systemctl', ['is-active', 'hermes-workspace.service'], {
      encoding: 'utf-8',
      timeout: 3_000,
    })
    serviceStatus = r.stdout.trim()
  } catch { /* ok */ }

  // Compute per-task workCwd so the script can run git log in the right repo
  const taskPayload = candidates.map((t) => {
    const { workCwd } = resolveSisterAndCwd(t)
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      column: t.column,
      agent_comment: t.agent_comment ?? '',
      last_history: (t.agent_history ?? []).slice(-3).map((e) => `[${e.by}] ${e.action}: ${e.note.slice(0, 120)}`).join('\n'),
      workCwd,
    }
  })

  const scriptContent = `
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const TASKS_FILE     = ${JSON.stringify(tasksFilePath)};
const HERMES_HOME    = ${JSON.stringify(hermesHome)};
const HERMES_BIN     = ${JSON.stringify(HERMES_BIN)};
const TASKS          = ${JSON.stringify(taskPayload)};
const SERVICE_STATUS = ${JSON.stringify(serviceStatus)};
const TG_TARGET      = 'telegram:2130622225';
const OR_MODELS      = ['nvidia/nemotron-3-super-120b-a12b:free','meta-llama/llama-4-maverick:free','google/gemma-3-27b-it:free'];
const LOCK_FILE      = TASKS_FILE + '.lock';

function sleep(ms) { const end = Date.now() + ms; while (Date.now() < end) {} }

function withTasksLock(fn) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(LOCK_FILE, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
      fs.closeSync(fd);
      try { return fn(); } finally { try { fs.unlinkSync(LOCK_FILE); } catch {} }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { const s = fs.statSync(LOCK_FILE); if (Date.now() - s.mtimeMs > 30_000) { fs.unlinkSync(LOCK_FILE); continue; } } catch {}
      sleep(50);
    }
  }
  return fn();
}

function readTasks() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8').trim();
    if (!raw) return { tasks: [] };
    const p = JSON.parse(raw);
    return { tasks: Array.isArray(p.tasks) ? p.tasks : [] };
  } catch { return { tasks: [] }; }
}

function writeTasks(data) {
  const content = JSON.stringify(data, null, 2) + '\\n';
  const tmp = TASKS_FILE + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, TASKS_FILE);
}

function updateTaskDirect(id, updates) {
  withTasksLock(() => {
    const file = readTasks();
    const idx = file.tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    file.tasks[idx] = { ...file.tasks[idx], ...updates, updated_at: new Date().toISOString() };
    writeTasks(file);
  });
}

function clearAgentState(id) {
  updateTaskDirect(id, { agent_state: null, agent_name: null, agent_action_at: null });
}

function loadOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const content = fs.readFileSync(path.join(HERMES_HOME, '.env'), 'utf-8');
    const m = content.match(/^OPENROUTER_API_KEY=(.+)$/m);
    return m?.[1]?.trim() ?? '';
  } catch { return ''; }
}

async function callAI(prompt) {
  const apiKey = loadOpenRouterKey();
  if (!apiKey) {
    // Fallback: use hermes CLI
    const r = spawnSync(HERMES_BIN, ['-z', prompt], { encoding: 'utf-8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    return r.stdout || '';
  }
  for (const model of OR_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.2 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      if (text.trim()) return text;
    } catch {}
  }
  return '';
}

function parseJSON(text) {
  const t = (text || '').trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\\{[\\s\\S]*\\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function sendTelegram(msg) {
  try { spawnSync(HERMES_BIN, ['send', '--to', TG_TARGET, '-q', msg], { encoding: 'utf-8', timeout: 15_000 }); } catch {}
}

// ── Main: check each task ────────────────────────────────────────────────────

for (const task of TASKS) {
  updateTaskDirect(task.id, { agent_state: 'reviewing', agent_name: 'astra', agent_action_at: new Date().toISOString() });

  // Per-task git log — use the task's own project directory
  let recentCommits = '';
  try {
    const gl = spawnSync('git', ['log', '--oneline', '-20'], {
      encoding: 'utf-8',
      cwd: task.workCwd || '.',
      timeout: 5_000,
    });
    recentCommits = gl.stdout.trim();
  } catch {}

  const evidence = [
    SERVICE_STATUS  ? 'Service status: hermes-workspace.service is ' + SERVICE_STATUS : '',
    recentCommits   ? 'Recent git commits for this project (newest first):\\n' + recentCommits : 'No git history found for this project.',
  ].filter(Boolean).join('\\n');

  const prompt =
    'You are Astra. Determine whether this task has been fully implemented and deployed.\\n\\n' +
    'Task: ' + task.title + '\\n' +
    'Description: ' + (task.description || '(none)') + '\\n' +
    (task.agent_comment ? 'Last agent note: ' + task.agent_comment + '\\n' : '') +
    (task.last_history ? 'Recent activity:\\n' + task.last_history + '\\n' : '') +
    '\\nDeployment evidence:\\n' + evidence + '\\n\\n' +
    'Decide:\\n' +
    '  done: true  → the task is clearly implemented, committed, and the service is running with the fix\\n' +
    '  done: false → the task is still in progress, no matching commits found, or deployment is uncertain\\n\\n' +
    'Return ONLY valid JSON (no other text):\\n' +
    '{"done": true|false, "confidence": "high|medium|low", "reason": "1 sentence explaining your decision"}';

  const raw    = await callAI(prompt);
  const result = parseJSON(raw);

  const now = new Date().toISOString();
  const file = readTasks();
  const taskRec = file.tasks.find(t => t.id === task.id);
  const existing = Array.isArray(taskRec?.agent_history) ? taskRec.agent_history : [];

  if (result && result.done === true && result.confidence !== 'low') {
    // Confirmed done — move to done column
    const note = result.reason || 'Astra verified: task is implemented and deployed.';
    updateTaskDirect(task.id, {
      column: 'done',
      agent_state:  null,
      agent_name:   null,
      agent_action_at: null,
      agent_comment: note,
      agent_history: [...existing, {
        id: randomUUID(), by: 'astra', byEmoji: '🌟',
        action: 'verified done', note, at: now,
      }],
    });
    sendTelegram('✅ 🌟 Astra verified done\\nTask: ' + task.title + '\\n' + note.slice(0, 280));
  } else {
    // Not done or uncertain — clear spinner, leave column unchanged
    const note = result?.reason || 'Could not confirm completion — task remains in current column.';
    updateTaskDirect(task.id, {
      agent_state:  null,
      agent_name:   null,
      agent_action_at: null,
      agent_history: [...existing, {
        id: randomUUID(), by: 'astra', byEmoji: '🌟',
        action: 'checked', note, at: now,
      }],
    });
  }
}
`

  const timestamp = Date.now()
  const scriptPath = `/tmp/completion-check-${timestamp}.mjs`
  fs.writeFileSync(scriptPath, scriptContent, 'utf-8')

  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return { taskCount: candidates.length }
}
