import { useEffect, useRef, useState } from 'react'
import type { ActivityEntry, ClaudeTask, CreateTaskInput, TaskAssignee, TaskColumn, TaskPriority } from '@/lib/tasks-api'
import {
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COLUMN_LABELS, COLUMN_ORDER } from '@/lib/tasks-api'

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

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
  onExecute?: () => Promise<void>
  isExecuting?: boolean
  onBreakdown?: () => Promise<void>
  isBreakingDown?: boolean
  onOpenSession?: (sessionId: string) => void
}

export function TaskDialog({ open, onOpenChange, task, defaultColumn, defaultTags, defaultTitle, defaultDescription, defaultPriority, defaultAssignee, assignees, onSubmit, isSubmitting, onComment, onExecute, isExecuting, onBreakdown, isBreakingDown, onOpenSession }: Props) {
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
  const historyEndRef = useRef<HTMLDivElement>(null)

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
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length])

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(540px,95vw)] border-[var(--theme-border)] bg-[var(--theme-bg)] overflow-hidden">
        {/* Accent top border */}
        <div className="h-[3px] w-full" style={{ background: 'var(--theme-accent)' }} />

        <div className="p-5 overflow-y-auto max-h-[85vh]">
          <DialogTitle className="text-base font-semibold text-[var(--theme-text)] mb-1">
            {isEdit ? 'Edit Task' : 'New Task'}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--theme-muted)] mb-4">
            {isEdit ? 'Update the task details below.' : 'Fill in the details for your new task.'}
          </DialogDescription>

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

            <div className="flex items-center justify-between pt-2">
              <p className="text-[10px] text-[var(--theme-muted)]">Press Esc to cancel</p>
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
                    style={{ background: isBreakingDown ? '#6d4fc7' : '#8b5cf6', color: 'white', opacity: isBreakingDown ? 0.7 : 1 }}
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
                    style={{ background: '#f59e0b', color: 'white', opacity: (isExecuting || task?.agent_state === 'working') ? 0.7 : 1 }}
                  >
                    {isExecuting ? '⏳ Executing…' : task?.agent_state === 'working' ? '● Working…' : '🚀 Execute'}
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting || !title.trim()}
                  style={{ background: 'var(--theme-accent)', color: 'white' }}
                >
                  {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
                </Button>
              </div>
            </div>
          </form>

          {/* Agent Activity feed — only shown when editing an existing task */}
          {isEdit && (
            <div className="border-t mt-4 pt-4" style={{ borderColor: 'var(--theme-border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h4
                  className="text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--theme-muted)' }}
                >
                  Agent Activity
                </h4>
                {task?.session_id && onOpenSession && (
                  <button
                    type="button"
                    onClick={() => onOpenSession(task.session_id!)}
                    className="text-[10px] hover:underline transition-opacity hover:opacity-80"
                    style={{ color: 'var(--theme-accent)' }}
                  >
                    Open in Chat →
                  </button>
                )}
              </div>

              {/* Waiting for user input banner */}
              {task?.agent_state === 'waiting_for_input' && (
                <div className="flex items-center gap-2 mb-3 rounded-md px-2.5 py-2" style={{ background: '#f59e0b11', border: '1px solid #f59e0b44' }}>
                  <span className="text-base shrink-0">💬</span>
                  <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>
                    Astra is waiting for your reply — answer below to continue.
                  </span>
                </div>
              )}

              {/* Live "currently working" pulse — mirrors card expand panel */}
              {(isExecuting || (task?.agent_state && task.agent_state !== 'waiting_for_input')) && (
                <div className="flex items-center gap-2 mb-3 rounded-md px-2.5 py-2" style={{ background: '#a855f711', border: '1px solid #a855f733' }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-ping shrink-0" style={{ background: '#a855f7' }} />
                  <span className="text-xs animate-pulse" style={{ color: '#a855f7' }}>
                    {isExecuting ? 'Sending task to agent…' : task?.agent_state === 'reviewing' ? 'Astra reviewing…' : task?.agent_state === 'delegating' ? 'Delegating to specialist…' : 'Agent working on this task…'}
                  </span>
                </div>
              )}

              <div className="max-h-52 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {history.length === 0 ? (
                  <p className="text-xs italic" style={{ color: 'var(--theme-muted)' }}>
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
                              <span className="font-medium capitalize" style={{ color: isQuestion ? '#f59e0b' : 'var(--theme-text)' }}>
                                {entry.by}
                              </span>
                              <span style={{ color: 'var(--theme-muted)' }}>·</span>
                              <span className="capitalize" style={{ color: isQuestion ? '#f59e0b' : 'var(--theme-muted)' }}>
                                {isQuestion ? 'asked' : entry.action}
                              </span>
                              <span style={{ color: 'var(--theme-muted)' }}>·</span>
                              <span style={{ color: 'var(--theme-muted)' }}>
                                {relativeTime(entry.at)}
                              </span>
                            </div>
                            <p className="mt-0.5 leading-relaxed" style={{ color: isQuestion ? '#f59e0b' : 'var(--theme-muted)' }}>
                              {entry.note}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div ref={historyEndRef} />
              </div>

              {/* User reply input */}
              {onComment && (
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
                    style={{ background: 'var(--theme-accent)', color: 'white', flexShrink: 0 }}
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
