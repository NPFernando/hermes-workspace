import type { ClaudeTask } from '@/lib/tasks-api'

export type TimeoutAnalysisData = {
  timedOutEntries: Array<{ task: ClaudeTask; note: string; at: string }>
  topAssignees: Array<[string, number]>
  topTags: Array<[string, number]>
  sample: Array<{ task: ClaudeTask; note: string; at: string }>
}

export function TimeoutAnalysisModal({
  data,
  rescuing,
  onClose,
  onSelectTask,
  onFilterTimedOut,
  onRescueAll,
}: {
  data: TimeoutAnalysisData
  rescuing: boolean
  onClose: () => void
  onSelectTask: (task: ClaudeTask) => void
  onFilterTimedOut: () => void
  onRescueAll: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(480px,94vw)] max-h-[80vh] rounded-xl border border-[var(--theme-border)] shadow-2xl flex flex-col"
        style={{ background: 'var(--theme-panel)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--theme-border)]">
          <h2 className="text-sm font-semibold text-[var(--theme-text)]">⏱ Timeout Analysis — today ({data.timedOutEntries.length} total)</h2>
          <button onClick={onClose} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] text-lg leading-none">✕</button>
        </div>
        <div className="overflow-y-auto scrollbar-thin p-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider mb-2">By Agent</p>
              {data.topAssignees.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2 mb-1.5">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--theme-hover)] overflow-hidden">
                    <div className="h-full rounded-full bg-orange-400" style={{ width: `${(count / data.timedOutEntries.length) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-[var(--theme-muted)] capitalize shrink-0 w-20 truncate">{name}</span>
                  <span className="text-[11px] font-medium text-orange-400 shrink-0">{count}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider mb-2">By Tag</p>
              {data.topTags.map(([tag, count]) => (
                <div key={tag} className="flex items-center gap-2 mb-1.5">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--theme-hover)] overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${(count / data.timedOutEntries.length) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-[var(--theme-muted)] shrink-0 w-20 truncate">{tag}</span>
                  <span className="text-[11px] font-medium text-amber-400 shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider mb-2">Sample Tasks</p>
            {data.sample.map((e, i) => (
              <div key={i} className="mb-2 pb-2 border-b border-[var(--theme-border)]/50 last:border-0">
                <button
                  type="button"
                  onClick={() => onSelectTask(e.task)}
                  className="text-[11px] text-[var(--theme-text)] hover:text-[var(--theme-accent)] text-left transition-colors line-clamp-1"
                >
                  {e.task.title}
                </button>
                {e.note && <p className="text-[10px] text-[var(--theme-muted)] mt-0.5 line-clamp-2">{e.note}</p>}
                <p className="text-[9px] text-[var(--theme-muted)] opacity-40 mt-0.5 capitalize">{e.task.assignee ?? 'unassigned'} · {e.task.tags?.slice(0,2).join(', ') || 'no tags'}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="shrink-0 flex gap-2 px-5 py-3 border-t border-[var(--theme-border)]">
          <button
            onClick={onFilterTimedOut}
            className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] px-3 py-2 hover:bg-[var(--theme-hover)] text-[var(--theme-text)] transition-colors"
          >Filter to timed-out tasks</button>
          <button
            onClick={onRescueAll}
            disabled={rescuing}
            className="flex-1 text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
          >{rescuing ? 'Rescuing…' : 'Rescue all'}</button>
        </div>
      </div>
    </>
  )
}
