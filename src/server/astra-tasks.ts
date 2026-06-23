import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createTask, getTask, listTasks, updateTask } from './tasks-store'
import { openaiChat } from './openai-compat-api'
import type { ActivityEntry, TaskColumn, TaskPriority, TaskRecord } from './tasks-store'

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

export function runAgentDeployBackground(): { taskCount: number } {
  const candidates = listTasks({ column: 'backlog' }).concat(listTasks({ column: 'todo' }))

  if (candidates.length === 0) return { taskCount: 0 }

  // Mark all as reviewing immediately (synchronous, before fork)
  markTasksAsReviewing(candidates.map((t) => t.id))

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

const TASKS_FILE = ${JSON.stringify(tasksFilePath)};
const HERMES_BIN = ${JSON.stringify(HERMES_BIN)};
const HERMES_HOME = ${JSON.stringify(hermesHome)};
const TASKS = ${JSON.stringify(taskPayload)};

const SISTER_EMOJIS = { astra: '🌟', luna: '🌙', ada: '💻', maya: '🔨', nova: '🔬', novus: '⚙️', user: '👤' };
const VALID_SISTERS = ['luna', 'ada', 'maya', 'nova', 'novus'];
const VALID_COLUMNS = ['backlog', 'todo', 'in_progress', 'review', 'blocked'];

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

function updateTaskDirect(taskId, updates) {
  const file = readTasks();
  const idx = file.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;
  file.tasks[idx] = { ...file.tasks[idx], ...updates, updated_at: new Date().toISOString() };
  writeTasks(file);
}

function callHermes(prompt) {
  const r = spawnSync(HERMES_BIN, ['-z', prompt], { encoding: 'utf-8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  return r.stdout || '';
}

function parseJSON(text) {
  const t = (text || '').trim();
  try { return JSON.parse(t); } catch {}
  const match = t.match(/\\{[\\s\\S]*\\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function getSoulMd(sister) {
  try {
    const p = path.join(HERMES_HOME, 'profiles', sister, 'SOUL.md');
    return fs.readFileSync(p, 'utf-8').slice(0, 600);
  } catch { return ''; }
}

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
    '2. column: "todo" (ready), "blocked" (needs more info), "backlog" (not yet)\\n' +
    '3. assignee: orchestrator | builder | researcher | reviewer | qa | ops-watch | maintainer | null\\n' +
    '4. sister_needed: null, "luna" (research/docs), "ada" (code review), "maya" (build/infra), "nova" (web research)\\n' +
    '5. astra_note: 1-2 sentence explanation of your decision\\n\\n' +
    'Return ONLY valid JSON, no other text:\\n' +
    '{"id":"...","priority":"medium","column":"todo","assignee":"builder","sister_needed":null,"astra_note":"..."}';

  const astraText = callHermes(astraPrompt);
  const astraResult = parseJSON(astraText);

  if (!astraResult) {
    updateTaskDirect(task.id, { agent_state: null, agent_name: null, agent_action_at: null });
    continue;
  }

  const { priority, column, assignee, sister_needed, astra_note } = astraResult;
  const historyToAdd = [];
  const astraEntry = {
    id: randomUUID(),
    by: 'astra',
    byEmoji: '🌟',
    action: 'reviewed',
    note: astra_note || 'Reviewed by Astra.',
    at: new Date().toISOString()
  };
  historyToAdd.push(astraEntry);
  let finalNote = astraEntry.note;

  if (sister_needed && VALID_SISTERS.includes(sister_needed)) {
    updateTaskDirect(task.id, { agent_state: 'delegating', agent_name: sister_needed, agent_action_at: new Date().toISOString() });
    const soulMd = getSoulMd(sister_needed);
    const sisterPrompt =
      (soulMd ? soulMd + '\\n\\n' : '') +
      'You are reviewing a task that Astra delegated to you because it needs your specialty.\\n\\n' +
      'Task: ' + task.title + '\\n' +
      'Description: ' + (task.description || '(none)') + '\\n' +
      "Astra's note: " + astraEntry.note + '\\n\\n' +
      'Give your specialist assessment in 2-3 sentences. Return ONLY valid JSON:\\n' +
      '{"note":"...","action":"reviewed"}';

    const sisterText = callHermes(sisterPrompt);
    const sisterResult = parseJSON(sisterText);
    if (sisterResult && sisterResult.note) {
      const sisterEntry = {
        id: randomUUID(),
        by: sister_needed,
        byEmoji: SISTER_EMOJIS[sister_needed] || '🤖',
        action: sisterResult.action || 'reviewed',
        note: sisterResult.note,
        at: new Date().toISOString()
      };
      historyToAdd.push(sisterEntry);
      finalNote = sisterResult.note;
    }
  }

  const current = getTaskDirect(task.id);
  const existingHistory = (current && Array.isArray(current.agent_history)) ? current.agent_history : [];

  updateTaskDirect(task.id, {
    priority: priority || task.priority,
    column: VALID_COLUMNS.includes(column) ? column : task.column,
    assignee: assignee !== undefined ? assignee : task.assignee,
    agent_comment: finalNote,
    agent_history: [...existingHistory, ...historyToAdd],
    agent_state: null,
    agent_name: null,
    agent_action_at: null
  });
}
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

  if (['ada', 'coder', 'reviewer'].includes(assignee)) {
    profileDir = 'coder'; displayName = 'Ada'; emoji = '💻'
  } else if (['maya', 'builder'].includes(assignee)) {
    profileDir = 'builder'; displayName = 'Maya'; emoji = '🔨'
  } else if (['luna', 'researcher'].includes(assignee)) {
    profileDir = 'researcher'; displayName = 'Luna'; emoji = '🌙'
  } else if (assignee === 'nova') {
    profileDir = 'nova'; displayName = 'Nova'; emoji = '🔬'
  } else if (['novus', 'local'].includes(assignee)) {
    profileDir = 'novus'; displayName = 'Novus'; emoji = '⚙️'
  }

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
      if (e.action === 'replied') return `[Naveen] ${e.note}`
      if (e.action === 'question') return `[You asked] ${e.note}`
      return `[You said] ${e.note}`
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
      'QUESTION: [only if you need input from Naveen]\n' +
      '</WORK_SUMMARY>\n\n' +
      'STATUS options: partial, done, blocked, needs_input'
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
      'QUESTION: [only if STATUS is needs_input]\n' +
      '</WORK_SUMMARY>\n\n' +
      'STATUS: partial | done | blocked | needs_input'
  }

  void (async () => {
    let output = ''

    const doChat = (signal: AbortSignal) =>
      openaiChat(
        [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg },
        ],
        { max_tokens: 900, temperature: 0.4, signal },
      )

    try {
      // The Hermes gateway can take 60-90s on free/large models once the full
      // Astra system prompt is included. A 45s cap caused successful requests to
      // be aborted and surfaced as the useless “AI analysis unavailable” task
      // note. Keep the background job bounded, but give the model enough room.
      output = await doChat(AbortSignal.timeout(150_000))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const cause = err instanceof Error && 'cause' in err
        ? String((err as { cause?: unknown }).cause)
        : ''
      console.error(`[executeTaskBackground] openaiChat failed: ${msg}${cause ? ` (cause: ${cause})` : ''} — retrying`)
      try {
        output = await doChat(AbortSignal.timeout(90_000))
      } catch (err2) {
        console.error('[executeTaskBackground] retry failed:', err2 instanceof Error ? err2.message : String(err2))
      }
    }

    let status = 'partial'
    let summary = ''
    let changes = ''
    let next = ''
    let question = ''

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
      const qMatch = parseSource.match(/QUESTION:\s*(.+)/i)
      if (smMatch) status = smMatch[1].toLowerCase()
      if (suMatch) summary = suMatch[1].trim().replace(/^\[|\]$/g, '')
      if (chMatch) changes = chMatch[1].trim().replace(/^\[|\]$/g, '')
      if (nxMatch) next = nxMatch[1].trim().replace(/^\[|\]$/g, '')
      if (qMatch) question = qMatch[1].trim().replace(/^\[|\]$/g, '')
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
      // Parsing completely failed
      const current = getTask(taskId)
      const existing = current?.agent_history ?? []
      updateTask(taskId, {
        agent_history: [...existing, {
          id: randomUUID(),
          by: displayName.toLowerCase(),
          byEmoji: emoji,
          action: 'blocked',
          note: 'AI analysis unavailable — please try again or use Launch Session.',
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

    if (status === 'needs_input' && (question || conversationalReply)) {
      const questionNote = question || conversationalReply
      updateTask(taskId, {
        agent_comment: questionNote,
        agent_history: [...existing, {
          id: randomUUID(),
          by: displayName.toLowerCase(),
          byEmoji: emoji,
          action: 'question',
          note: questionNote,
          at: new Date().toISOString(),
        }],
        agent_state: 'waiting_for_input',
        agent_name: displayName.toLowerCase(),
        agent_action_at: new Date().toISOString(),
        waiting_for_user: true,
        column: newColumn,
      })
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
  })()
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

  const titles: Array<string> = []

  for (const sub of subtasks) {
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
