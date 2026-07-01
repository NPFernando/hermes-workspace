export type UnlockModalPrereq = { id: string; title: string; count: number }

export function UnlockPrereqModal({
  prereq,
  unlocking,
  onClose,
  onConfirm,
}: {
  prereq: UnlockModalPrereq
  unlocking: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--theme-border)]">
          <span className="font-semibold text-sm text-[var(--theme-text)]">🔓 Unlock Gated Tasks</span>
          <button type="button" onClick={onClose} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-xs text-[var(--theme-muted)]">
            Marking this prerequisite as <strong className="text-amber-400">done</strong> will immediately unlock <strong className="text-[var(--theme-text)]">{prereq.count} waiting task{prereq.count !== 1 ? 's' : ''}</strong> and trigger a deploy sweep.
          </p>
          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs font-medium text-amber-400">{prereq.title.slice(0, 100)}</p>
            <p className="text-[9px] text-amber-400/60 mt-0.5">{prereq.count} task{prereq.count !== 1 ? 's' : ''} waiting on this</p>
          </div>
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] px-3 py-2 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] transition-colors"
            >Cancel</button>
            <button
              type="button"
              disabled={unlocking}
              onClick={onConfirm}
              className="flex-1 text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
            >{unlocking ? 'Unlocking…' : `Confirm — unlock ${prereq.count} tasks`}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
