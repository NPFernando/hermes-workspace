import { cn } from '@/lib/utils'

export type ArchivePreview = {
  buckets: { days30: number; days60: number; days90: number }
  previews: Array<{ id: string; title: string; assignee: string | null; ageDays: number }>
}

export function ArchiveWizardModal({
  preview,
  days,
  onDaysChange,
  archiving,
  onClose,
  onConfirm,
}: {
  preview: ArchivePreview
  days: number
  onDaysChange: (days: number) => void
  archiving: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const bucketKey = `days${days}` as 'days30' | 'days60' | 'days90'
  const bucketCount = preview.buckets[bucketKey]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--theme-border)]">
          <span className="font-semibold text-sm text-[var(--theme-text)]">🗂️ Archive Stale Tasks</span>
          <button type="button" onClick={onClose} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <p className="text-xs text-[var(--theme-muted)]">Move inactive todo/backlog tasks to done. Only tasks with zero agent activity since the cutoff are affected.</p>
          <div className="grid grid-cols-3 gap-3">
            {([30, 60, 90] as const).map(bucketDays => {
              const count = bucketDays === 30 ? preview.buckets.days30 : bucketDays === 60 ? preview.buckets.days60 : preview.buckets.days90
              return (
                <button
                  key={bucketDays}
                  type="button"
                  onClick={() => onDaysChange(bucketDays)}
                  className={cn(
                    'flex flex-col items-center p-3 rounded-lg border transition-colors',
                    days === bucketDays ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]' : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]',
                  )}
                >
                  <span className="text-lg font-bold">{count}</span>
                  <span className="text-[9px] uppercase tracking-wide">{bucketDays}+ days</span>
                </button>
              )
            })}
          </div>
          <div>
            <p className="text-[10px] text-[var(--theme-muted)] mb-2">Oldest inactive tasks (preview):</p>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto scrollbar-thin">
              {preview.previews.filter(p => p.ageDays >= days).slice(0, 10).map(p => (
                <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--theme-hover)]">
                  <span className="text-[10px] text-[var(--theme-text)] truncate flex-1">{p.title.slice(0, 55)}</span>
                  <span className="text-[9px] text-[var(--theme-muted)] opacity-60 shrink-0">{p.ageDays}d</span>
                </div>
              ))}
              {preview.previews.filter(p => p.ageDays >= days).length === 0 && (
                <p className="text-xs text-[var(--theme-muted)] opacity-50 text-center py-2">No tasks older than {days} days</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-[var(--theme-border)]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] px-3 py-2 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] transition-colors"
          >Cancel</button>
          <button
            type="button"
            disabled={archiving || bucketCount === 0}
            onClick={onConfirm}
            className="flex-1 text-xs rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-40"
          >{archiving ? 'Archiving…' : `Archive ${bucketCount} tasks`}</button>
        </div>
      </div>
    </div>
  )
}
