import type { ClaudeTask } from '@/lib/tasks-api'
import { relativeTime } from '@/lib/tasks-api'

const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--theme-danger)',
  medium: 'var(--theme-warning)',
  low: 'var(--theme-muted)',
}
const ACTION_COLORS: Record<string, string> = {
  completed: 'var(--theme-success)',
  blocked: 'var(--theme-danger)',
  timed_out: 'var(--theme-warning)',
  planned: 'var(--theme-accent-secondary)',
  question: 'var(--theme-warning)',
  rescued: 'var(--theme-accent)',
}

export function TaskDetailPanel({
  task,
  isExecuting,
  onClose,
  onEdit,
  onExecute,
}: {
  task: ClaudeTask
  isExecuting: boolean
  onClose: () => void
  onEdit: () => void
  onExecute: () => void
}) {
  const history = task.agent_history ?? []
  const lastPlan = [...history].reverse().find((h) => h.action === 'planned')
  const priorityCol = PRIORITY_COLOR[task.priority] ?? 'var(--theme-muted)'

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-[min(420px,92vw)] flex flex-col border-l border-[var(--theme-border)] shadow-2xl overflow-hidden"
        style={{ background: 'var(--theme-panel)' }}
      >
        <div className="flex items-start gap-2 px-4 py-3 border-b border-[var(--theme-border)]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--theme-text)] leading-snug">
              {task.title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className="text-[10px] px-2 py-0.5 rounded-full border"
                style={{
                  borderColor: priorityCol,
                  color: priorityCol,
                  background: `color-mix(in srgb, ${priorityCol} 9%, transparent)`,
                }}
              >
                {task.priority}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-border)] text-[var(--theme-muted)] capitalize">
                {task.column.replace(/_/g, ' ')}
              </span>
              {task.assignee && (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-border)] text-[var(--theme-muted)] capitalize">
                  {task.assignee}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-[var(--theme-hover)] text-[var(--theme-muted)] transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {lastPlan && (
          <div className="px-4 pt-3 pb-0 shrink-0">
            <p className="text-[10px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider mb-1">
              Plan
            </p>
            <p className="text-[11px] text-[var(--theme-text)] leading-relaxed line-clamp-6 whitespace-pre-wrap">
              {lastPlan.note}
            </p>
          </div>
        )}

        {!lastPlan && task.agent_comment && (
          <div className="px-4 pt-3 pb-0 shrink-0">
            <p className="text-[10px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider mb-1">
              Note
            </p>
            <p className="text-[11px] text-[var(--theme-text)] leading-relaxed line-clamp-6">
              {task.agent_comment}
            </p>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3">
          <p className="text-[10px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider mb-2">
            History ({history.length})
          </p>
          {history.length === 0 && (
            <p className="text-[11px] text-[var(--theme-muted)] opacity-50">
              No agent activity yet
            </p>
          )}
          <div className="flex flex-col gap-2">
            {[...history]
              .reverse()
              .slice(0, 30)
              .map((h, i) => {
                const col = ACTION_COLORS[h.action] ?? 'var(--theme-muted)'
                const ageStr = h.at ? relativeTime(h.at) : ''
                return (
                  <div key={i} className="flex gap-2 items-start">
                    <span
                      className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full"
                      style={{ background: col, marginTop: 4 }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[10px] font-medium capitalize"
                          style={{ color: col }}
                        >
                          {h.action.replace(/_/g, ' ')}
                        </span>
                        {ageStr && (
                          <span className="text-[9px] text-[var(--theme-muted)] opacity-50">
                            {ageStr}
                          </span>
                        )}
                      </div>
                      {h.note && (
                        <p className="text-[10px] text-[var(--theme-muted)] leading-relaxed mt-0.5 line-clamp-3">
                          {h.note}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[var(--theme-border)]">
          <button
            onClick={onEdit}
            className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] px-3 py-2 hover:bg-[var(--theme-hover)] text-[var(--theme-text)] transition-colors"
          >
            Edit
          </button>
          {task.column !== 'done' && task.column !== 'blocked' && (
            <button
              onClick={onExecute}
              disabled={isExecuting || !!task.agent_state}
              className="flex-1 text-xs rounded-lg border border-[color-mix(in_srgb,var(--theme-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] px-3 py-2 text-[var(--theme-warning)] hover:bg-[color-mix(in_srgb,var(--theme-warning)_20%,transparent)] transition-colors disabled:opacity-40"
            >
              {isExecuting ? 'Starting…' : 'Execute'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
