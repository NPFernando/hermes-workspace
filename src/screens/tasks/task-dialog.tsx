import { useEffect, useRef, useState } from 'react'
import type { ActivityEntry, ClarificationQuestion, ClaudeTask, CreateTaskInput, TaskAssignee, TaskColumn, TaskPriority } from '@/lib/tasks-api'
import {
  DialogContent,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COLUMN_LABELS, COLUMN_ORDER, relativeTime } from '@/lib/tasks-api'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: ClaudeTask | null
  defaultColumn?: TaskColumn
  defaultTags?: string
  assignees: Array<TaskAssignee>
  onSubmit: (input: CreateTaskInput) => Promise<void>
  isSubmitting: boolean
  defaultTitle?: string
  defaultDescription?: string
  defaultPriority?: TaskPriority
  defaultAssignee?: string
  onComment?: (taskId: string, text: string) => Promise<void>
  onClarify?: (taskId: string, answers: Record<string, string>) => Promise<void>
  onExecute?: () => Promise<void>
  isExecuting?: boolean
  onBreakdown?: () => Promise<void>
  isBreakingDown?: boolean
  onOpenSession?: (sessionId: string) => void
}

// Sentinel value used when the user clicks "Custom…" but hasn't typed yet
const CUSTOM_SENTINEL = '__custom__'

function ClarificationPanel({
  questions,
  onSubmit,
  inputClass,
}: {
  questions: Array<ClarificationQuestion>
  onSubmit: (answers: Record<string, string>) => Promise<void>
  inputClass: string
}) {
  // answers keyed by question id; for "Custom…" selections, stores the typed text
  const [localAnswers, setLocalAnswers] = useState<Record<string, string>>({})
  // separate storage for the custom text box so we can distinguish "option selected"
  // from "custom box is open but empty"
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({})
  // which pending question is shown right now
  const [currentIdx, setCurrentIdx] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const serverAnswered = questions.filter(q => q.answer)
  const pending = questions.filter(q => !q.answer)
  const currentQ = pending.at(currentIdx) ?? null
  const isLast = currentIdx === pending.length - 1

  const currentValue = currentQ ? (localAnswers[currentQ.id] ?? '') : ''
  const currentIsValid = currentValue.trim() !== '' && currentValue !== CUSTOM_SENTINEL

  // Focus textarea whenever the current question changes (if it has no options)
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus()
  }, [currentIdx])

  function advance() {
    setCurrentIdx(i => Math.min(i + 1, pending.length - 1))
  }

  // Go back to pendingIdx, clearing that question's answer and all after it
  function goBackTo(pendingIdx: number) {
    setCurrentIdx(pendingIdx)
    setLocalAnswers(prev => {
      const next = { ...prev }
      for (let i = pendingIdx; i < pending.length; i++) delete next[pending[i].id]
      return next
    })
    setCustomTexts(prev => {
      const next = { ...prev }
      for (let i = pendingIdx; i < pending.length; i++) delete next[pending[i].id]
      return next
    })
  }

  function pickOption(qId: string, opt: string) {
    if (opt === CUSTOM_SENTINEL) {
      // Switch to custom mode — keep whatever the user typed before
      setLocalAnswers(prev => ({ ...prev, [qId]: customTexts[qId] || CUSTOM_SENTINEL }))
    } else {
      setLocalAnswers(prev => ({ ...prev, [qId]: opt }))
      // Auto-advance after a brief visual flash (not on last question)
      if (!isLast) setTimeout(advance, 180)
    }
  }

  function setCustomText(qId: string, text: string) {
    setCustomTexts(prev => ({ ...prev, [qId]: text }))
    setLocalAnswers(prev => ({ ...prev, [qId]: text || CUSTOM_SENTINEL }))
  }

  async function handleSubmit() {
    if (!currentIsValid || submitting) return
    setSubmitting(true)
    try {
      const merged: Record<string, string> = {}
      for (const q of serverAnswered) merged[q.id] = q.answer!
      for (const q of pending) {
        const v = localAnswers[q.id] ?? ''
        if (v && v !== CUSTOM_SENTINEL) merged[q.id] = v
      }
      await onSubmit(merged)
    } finally {
      setSubmitting(false)
    }
  }

  if (!currentQ) return null

  const currentOptions = currentQ.options ?? []
  const hasOptions = currentOptions.length > 0
  const selectedOpt = hasOptions
    ? (currentOptions.includes(currentValue) ? currentValue : currentValue ? CUSTOM_SENTINEL : '')
    : ''
  const isCustomMode = selectedOpt === CUSTOM_SENTINEL

  // Questions already answered in this session (before currentIdx)
  const locallyAnswered = pending.slice(0, currentIdx)
  const hasThread = serverAnswered.length > 0 || locallyAnswered.length > 0

  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 space-y-3 mt-3">

      {/* Answered thread — compact read-only */}
      {hasThread && (
        <div className="space-y-1 pb-2 border-b border-amber-400/15">
          {serverAnswered.map((q, i) => (
            <div key={q.id} className="flex gap-1.5 text-[11px]">
              <span className="text-amber-400/40 shrink-0 w-4">{i + 1}.</span>
              <span className="text-amber-400/50 truncate">{q.question}</span>
              <span className="text-[var(--theme-muted)] ml-auto shrink-0 max-w-[45%] truncate">→ {q.answer}</span>
            </div>
          ))}
          {locallyAnswered.map((q, i) => (
            <div key={q.id} className="flex gap-1.5 text-[11px] items-center">
              <span className="text-amber-400/50 shrink-0 w-4">{serverAnswered.length + i + 1}.</span>
              <span className="text-amber-400/60 truncate">{q.question}</span>
              <span className="text-[var(--theme-muted)] ml-auto shrink-0 max-w-[40%] truncate">→ {localAnswers[q.id]}</span>
              <button
                type="button"
                onClick={() => goBackTo(i)}
                className="shrink-0 opacity-40 hover:opacity-100 transition-opacity leading-none"
                title="Edit this answer"
              >
                ✏️
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">
          Question {serverAnswered.length + currentIdx + 1} of {questions.length}
        </span>
        {pending.length > 1 && (
          <div className="ml-auto flex items-center gap-1">
            {pending.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full transition-colors duration-200',
                  i < currentIdx ? 'bg-amber-500' : i === currentIdx ? 'bg-amber-400' : 'bg-amber-400/20',
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Current question text */}
      <p className="text-sm font-medium text-[var(--theme-text)]">{currentQ.question}</p>

      {/* Option buttons */}
      {hasOptions && (
        <div className="flex flex-wrap gap-1.5">
          {currentOptions.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => pickOption(currentQ.id, opt)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs border transition-all duration-150',
                selectedOpt === opt
                  ? 'bg-amber-500 text-white border-amber-500 scale-[1.03]'
                  : 'bg-transparent text-amber-400 border-amber-400/40 hover:border-amber-400 hover:bg-amber-400/5',
              )}
            >
              {opt}
            </button>
          ))}
          <button
            type="button"
            onClick={() => pickOption(currentQ.id, CUSTOM_SENTINEL)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs border transition-all duration-150',
              isCustomMode
                ? 'bg-amber-400/15 text-amber-400 border-amber-400'
                : 'bg-transparent text-amber-400/50 border-amber-400/20 hover:border-amber-400/50 hover:text-amber-400/80',
            )}
          >
            Custom…
          </button>
        </div>
      )}

      {/* Free-form textarea — shown when no options, or Custom is active */}
      {(!hasOptions || isCustomMode) && (
        <textarea
          ref={textareaRef}
          rows={2}
          className={cn(inputClass, 'resize-none border-amber-400/20 focus:ring-amber-400/40 text-xs py-1.5')}
          placeholder={hasOptions ? 'Enter your custom answer…' : isLast ? 'Your answer… (Enter to submit)' : 'Your answer… (Enter to continue)'}
          value={hasOptions ? (customTexts[currentQ.id] ?? '') : currentValue}
          onChange={e => {
            if (hasOptions) setCustomText(currentQ.id, e.target.value)
            else setLocalAnswers(prev => ({ ...prev, [currentQ.id]: e.target.value }))
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && currentIsValid) {
              e.preventDefault()
              if (isLast) void handleSubmit()
              else advance()
            }
          }}
        />
      )}

      {/* Footer: hint or next/submit button */}
      {isLast ? (
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={!currentIsValid || submitting}
          className="w-full bg-amber-500 text-white disabled:opacity-40"
        >
          {submitting ? 'Sending…' : 'Submit & resume agent'}
        </Button>
      ) : (
        <div className="flex items-center justify-between">
          {hasOptions && !isCustomMode
            ? <span className="text-[10px] text-amber-400/40">Select an option to continue</span>
            : <span className="text-[10px] text-amber-400/40">Enter to continue</span>
          }
          {(!hasOptions || isCustomMode) && (
            <button
              type="button"
              onClick={() => { if (currentIsValid) advance() }}
              disabled={!currentIsValid}
              className="text-[10px] text-amber-400/60 hover:text-amber-400 disabled:opacity-30 transition-colors"
            >
              Next →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function TaskDialog({ open, onOpenChange, task, defaultColumn, defaultTags, defaultTitle, defaultDescription, defaultPriority, defaultAssignee, assignees, onSubmit, isSubmitting, onComment, onClarify, onExecute, isExecuting, onBreakdown, isBreakingDown, onOpenSession }: Props) {
  const isEdit = Boolean(task)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [column, setColumn] = useState<TaskColumn>(defaultColumn ?? 'backlog')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assignee, setAssignee] = useState<string>('')
  const [tags, setTags] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [commentText, setCommentText] = useState('')
  const [commentSending, setCommentSending] = useState(false)
  const activityScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description)
      setColumn(task.column)
      setPriority(task.priority)
      setAssignee(task.assignee ?? '')
      setTags(task.tags.join(', '))
      setDueDate(task.due_date ?? '')
    } else {
      setTitle(defaultTitle ?? '')
      setDescription(defaultDescription ?? '')
      setColumn(defaultColumn ?? 'backlog')
      setPriority(defaultPriority ?? 'medium')
      setAssignee(defaultAssignee ?? '')
      setTags(defaultTags ?? '')
      setDueDate('')
    }
    setCommentText('')
  }, [task, open, defaultColumn, defaultTags, defaultTitle, defaultDescription, defaultPriority, defaultAssignee])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      column,
      priority,
      assignee: assignee || null,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      due_date: dueDate || null,
    })
  }

  async function handlePostComment() {
    if (!commentText.trim() || !task || !onComment) return
    setCommentSending(true)
    try {
      await onComment(task.id, commentText.trim())
      setCommentText('')
    } finally {
      setCommentSending(false)
    }
  }

  const inputClass = cn(
    'w-full rounded-lg border px-3 py-2 text-sm',
    'bg-[var(--theme-input)] border-[var(--theme-border)] text-[var(--theme-text)]',
    'focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]',
    'placeholder:text-[var(--theme-muted)]',
  )

  const labelClass = 'block text-xs font-medium text-[var(--theme-muted)] mb-1'

  const history: Array<ActivityEntry> = task?.agent_history ?? []

  useEffect(() => {
    const el = activityScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history.length])

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(540px,95vw)] border-[var(--theme-border)] bg-[var(--theme-bg)] overflow-hidden">
        {/* Accent top border */}
        <div className="h-[3px] w-full bg-[var(--theme-accent)]" />

        <div className="p-5 overflow-y-auto max-h-[85vh]">
          <DialogTitle className="text-base font-semibold text-[var(--theme-text)] mb-4">
            {isEdit ? 'Edit Task' : 'New Task'}
          </DialogTitle>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className={labelClass}>Title *</label>
              <input
                className={inputClass}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                required
                autoFocus
              />
            </div>

            <div>
              <label className={labelClass}>Description</label>
              <textarea
                className={cn(inputClass, 'resize-none')}
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional details..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Column</label>
                <select
                  className={inputClass}
                  style={{ colorScheme: 'dark' }}
                  value={column}
                  onChange={e => setColumn(e.target.value as TaskColumn)}
                >
                  {COLUMN_ORDER.map(col => (
                    <option key={col} value={col}>{COLUMN_LABELS[col]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Priority</label>
                <select
                  className={inputClass}
                  style={{ colorScheme: 'dark' }}
                  value={priority}
                  onChange={e => setPriority(e.target.value as TaskPriority)}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Assignee</label>
                <select
                  className={inputClass}
                  style={{ colorScheme: 'dark' }}
                  value={assignee}
                  onChange={e => setAssignee(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {assignees.map(({ id, label }) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                  Assignee is separate from status. Dragging a card changes its column only.
                </p>
              </div>
              <div>
                <label className={labelClass}>Due Date</label>
                <input
                  type="date"
                  className={inputClass}
                  style={{ colorScheme: 'dark' }}
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Tags (comma-separated)</label>
              <input
                className={inputClass}
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="frontend, bug, research"
              />
            </div>

            <div className="flex items-center justify-end pt-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                {isEdit && onBreakdown && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void onBreakdown()}
                    disabled={isBreakingDown}
                    className={isBreakingDown ? 'bg-violet-700 text-white opacity-70' : 'bg-violet-500 text-white'}
                  >
                    {isBreakingDown ? '⏳ Breaking down…' : '✦ Break Down'}
                  </Button>
                )}
                {isEdit && onExecute && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void onExecute()}
                    disabled={isExecuting || task?.agent_state === 'working'}
                    className={`bg-amber-500 text-white ${(isExecuting || task?.agent_state === 'working') ? 'opacity-70' : ''}`}
                  >
                    {isExecuting ? '⏳ Executing…' : task?.agent_state === 'working' ? '● Working…' : '🚀 Execute'}
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting || !title.trim()}
                  className="bg-[var(--theme-accent)] text-white"
                >
                  {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
                </Button>
              </div>
            </div>
          </form>

          {/* Agent Activity feed — only shown when editing an existing task */}
          {isEdit && (
            <div className="border-t mt-4 pt-4 border-[var(--theme-border)]">
              <div className="flex items-center justify-between mb-3">
                <h4
                  className="text-[10px] font-semibold uppercase tracking-widest text-[var(--theme-muted)]"
                >
                  Agent Activity
                </h4>
                {task?.session_id && onOpenSession && (
                  <button
                    type="button"
                    onClick={() => onOpenSession(task.session_id!)}
                    className="text-[10px] hover:underline transition-opacity hover:opacity-80 text-[var(--theme-accent)]"
                  >
                    Open in Chat →
                  </button>
                )}
              </div>

              {/* Waiting for user input banner — only shown when no structured questions */}
              {task?.agent_state === 'waiting_for_input' && !task?.clarification_questions?.length && (
                <div className="flex items-center gap-2 mb-3 rounded-md border border-amber-300/25 bg-amber-400/8 px-2.5 py-2">
                  <span className="text-base shrink-0">💬</span>
                  <span className="text-xs font-medium text-amber-500">
                    Astra is waiting for your reply — answer below to continue.
                  </span>
                </div>
              )}

              {/* Live "currently working" pulse — mirrors card expand panel */}
              {(isExecuting || (task?.agent_state && task.agent_state !== 'waiting_for_input')) && (
                <div className="flex items-center gap-2 mb-3 rounded-md border border-violet-400/20 bg-violet-400/8 px-2.5 py-2">
                  <span className="w-1.5 h-1.5 rounded-full animate-ping shrink-0 bg-violet-400" />
                  <span className="text-xs animate-pulse text-violet-400">
                    {isExecuting ? 'Sending task to agent…' : task?.agent_state === 'reviewing' ? 'Astra reviewing…' : task?.agent_state === 'delegating' ? 'Delegating to specialist…' : 'Agent working on this task…'}
                  </span>
                </div>
              )}

              <div ref={activityScrollRef} className="max-h-52 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {history.length === 0 ? (
                  <p className="text-xs italic text-[var(--theme-muted)]">
                    {isExecuting || task?.agent_state
                      ? 'Activity will appear here as the agent works…'
                      : 'No agent activity yet. Click "Execute" or "Deploy Agents" to start.'}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {history.map((entry) => {
                      const isQuestion = entry.action === 'question'
                      return (
                        <div
                          key={entry.id}
                          className="flex gap-2 text-xs rounded-md"
                          style={isQuestion ? { background: '#f59e0b0d', border: '1px solid #f59e0b33', padding: '6px 8px' } : undefined}
                        >
                          <span className="shrink-0 text-base leading-none mt-0.5">{entry.byEmoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className={isQuestion ? 'text-amber-500 font-medium capitalize' : 'font-medium capitalize text-[var(--theme-text)]'}>
                                {entry.by}
                              </span>
                              <span className="text-[var(--theme-muted)]">·</span>
                              <span className={isQuestion ? 'text-amber-500 capitalize' : 'text-[var(--theme-muted)] capitalize'}>
                                {isQuestion ? 'asked' : entry.action}
                              </span>
                              <span className="text-[var(--theme-muted)]">·</span>
                              <span className="text-[var(--theme-muted)]">
                                {relativeTime(entry.at)}
                              </span>
                            </div>
                            <p className={`mt-0.5 leading-relaxed ${isQuestion ? 'text-amber-500' : 'text-[var(--theme-muted)]'}`}>
                              {entry.note}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Structured clarification Q&A — shown when agent asks targeted questions */}
              {task?.waiting_for_user && task.clarification_questions && task.clarification_questions.length > 0 && onClarify && (
                <ClarificationPanel
                  questions={task.clarification_questions}
                  inputClass={inputClass}
                  onSubmit={(answers) => onClarify(task.id, answers)}
                />
              )}

              {/* Freeform comment / reply input — hidden during structured clarification */}
              {onComment && !(task?.waiting_for_user && task?.clarification_questions?.length) && (
                <div className="flex gap-2 mt-3">
                  <input
                    className={cn(inputClass, 'text-xs py-1.5')}
                    placeholder={task?.agent_state === 'waiting_for_input' ? 'Reply to Astra… (Enter to send and resume)' : 'Ask a question or add a note… (Enter to send)'}
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void handlePostComment()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handlePostComment()}
                    disabled={!commentText.trim() || commentSending}
                    className="bg-[var(--theme-accent)] text-white shrink-0"
                  >
                    {commentSending ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
