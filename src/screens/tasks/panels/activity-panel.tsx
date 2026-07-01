import type { ClaudeTask } from '@/lib/tasks-api'
import { cn } from '@/lib/utils'

export type NotifEvent = { taskId: string; taskTitle: string; action: string; at: string; note: string; by: string }

export function ActivityPanel({
  activityTab,
  onTabChange,
  inboxTasks,
  inboxReplies,
  onReplyChange,
  onReplySubmit,
  inboxSending,
  notifEvents,
  unreadNotifCount,
  notifLastSeen,
  onSelectTask,
  onSelectTaskById,
  onClose,
}: {
  activityTab: 'inbox' | 'feed'
  onTabChange: (tab: 'inbox' | 'feed') => void
  inboxTasks: Array<ClaudeTask>
  inboxReplies: Record<string, string>
  onReplyChange: (taskId: string, value: string) => void
  onReplySubmit: (taskId: string) => void
  inboxSending: string | null
  notifEvents: Array<NotifEvent>
  unreadNotifCount: number
  notifLastSeen: string
  onSelectTask: (task: ClaudeTask) => void
  onSelectTaskById: (taskId: string) => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[min(440px,94vw)] flex flex-col border-l border-[var(--theme-border)] shadow-2xl"
        style={{ background: 'var(--theme-panel)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border)]">
          <h2 className="text-sm font-semibold text-[var(--theme-text)]">⚑ Activity</h2>
          <button onClick={onClose} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] text-lg leading-none">✕</button>
        </div>
        <div className="flex border-b border-[var(--theme-border)]">
          <button
            type="button"
            onClick={() => onTabChange('inbox')}
            className={cn('flex-1 py-2 text-xs font-medium transition-colors', activityTab === 'inbox' ? 'text-[var(--theme-accent)] border-b-2 border-[var(--theme-accent)]' : 'text-[var(--theme-muted)] hover:text-[var(--theme-text)]')}
          >
            📥 Action Required{inboxTasks.length > 0 ? ` (${inboxTasks.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() => onTabChange('feed')}
            className={cn('flex-1 py-2 text-xs font-medium transition-colors relative', activityTab === 'feed' ? 'text-[var(--theme-accent)] border-b-2 border-[var(--theme-accent)]' : 'text-[var(--theme-muted)] hover:text-[var(--theme-text)]')}
          >
            🔔 Recent
            {unreadNotifCount > 0 && activityTab !== 'feed' && (
              <span className="ml-1 text-[9px] px-1 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">{unreadNotifCount}</span>
            )}
          </button>
        </div>

        {activityTab === 'inbox' && (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin divide-y divide-[var(--theme-border)]">
            {inboxTasks.length === 0 && (
              <div className="text-center py-12 text-xs text-[var(--theme-muted)] opacity-50">No tasks waiting for your input</div>
            )}
            {inboxTasks.map(t => {
              const lastAgentMsg = [...(t.agent_history ?? [])].reverse().find(h => h.action !== 'rescued' && h.note)
              const ageMs = t.agent_action_at ? Date.now() - new Date(t.agent_action_at).getTime() : null
              const ago = ageMs ? (ageMs < 3600_000 ? `${Math.round(ageMs / 60_000)}m ago` : `${Math.round(ageMs / 3600_000)}h ago`) : ''
              return (
                <div key={t.id} className="p-4">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectTask(t)}
                        className="text-xs font-medium text-[var(--theme-text)] hover:text-[var(--theme-accent)] text-left transition-colors line-clamp-2"
                      >{t.title}</button>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] text-[var(--theme-muted)] opacity-50 capitalize">{t.assignee ?? 'unassigned'}</span>
                        {ago && <span className="text-[9px] text-[var(--theme-muted)] opacity-40">{ago}</span>}
                      </div>
                    </div>
                  </div>
                  {(lastAgentMsg?.note || t.agent_comment) && (
                    <div className="mb-2 text-[11px] text-[var(--theme-muted)] bg-[var(--theme-hover)] rounded-lg px-3 py-2 leading-relaxed line-clamp-4">
                      {lastAgentMsg?.note ?? t.agent_comment}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inboxReplies[t.id] ?? ''}
                      onChange={e => onReplyChange(t.id, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') onReplySubmit(t.id) }}
                      placeholder="Reply… (Enter to send)"
                      disabled={inboxSending === t.id}
                      className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2.5 py-1.5 text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)] placeholder:text-[var(--theme-muted)] disabled:opacity-50"
                    />
                    {inboxSending === t.id && <span className="text-[10px] text-[var(--theme-muted)] self-center">Sending…</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {activityTab === 'feed' && (
          <div className="flex-1 overflow-y-auto scrollbar-thin p-3 flex flex-col gap-2">
            {notifEvents.length === 0 && (
              <div className="text-center py-8 text-xs text-[var(--theme-muted)] opacity-50">No activity in the last 24h</div>
            )}
            {notifEvents.map((ev, i) => {
              const isNew = ev.at > notifLastSeen
              const ageMs = Date.now() - new Date(ev.at).getTime()
              const ago = ageMs < 3600_000 ? `${Math.round(ageMs / 60_000)}m` : `${Math.round(ageMs / 3600_000)}h`
              const icon = ev.action === 'completed' ? '✅' : ev.action === 'blocked' ? '🚫' : ev.action === 'timed_out' ? '⏱️' : ev.action === 'planned' ? '📋' : ev.action === 'question' ? '❓' : '🔄'
              const color = ev.action === 'completed' ? 'text-emerald-400' : ev.action === 'blocked' || ev.action === 'timed_out' ? 'text-rose-400' : ev.action === 'planned' ? 'text-sky-400' : 'text-[var(--theme-muted)]'
              return (
                <button
                  key={`${ev.taskId}-${ev.at}-${i}`}
                  type="button"
                  onClick={() => onSelectTaskById(ev.taskId)}
                  className={cn('text-left px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--theme-hover)]', isNew ? 'border-violet-500/30 bg-violet-500/5' : 'border-[var(--theme-border)]')}
                >
                  <div className="flex items-center gap-2">
                    <span>{icon}</span>
                    <span className={cn('text-[10px] font-medium capitalize', color)}>{ev.action.replace('_', ' ')}</span>
                    <span className="text-[9px] text-[var(--theme-muted)] opacity-50 ml-auto">{ago} ago</span>
                  </div>
                  <p className="text-[11px] text-[var(--theme-text)] truncate mt-0.5">{ev.taskTitle.slice(0, 60)}</p>
                  {ev.note && <p className="text-[9px] text-[var(--theme-muted)] opacity-60 truncate mt-0.5">{ev.note.slice(0, 80)}</p>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
