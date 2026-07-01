export function SisterRebalanceModal({
  sisterChips,
  rebalanceFrom,
  rebalanceTo,
  rebalanceCount,
  rebalancing,
  onClose,
  onFromChange,
  onToChange,
  onCountChange,
  onConfirm,
}: {
  sisterChips: Array<[string, number]>
  rebalanceFrom: string
  rebalanceTo: string
  rebalanceCount: number
  rebalancing: boolean
  onClose: () => void
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onCountChange: (value: number) => void
  onConfirm: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(380px,92vw)] rounded-xl border border-[var(--theme-border)] shadow-2xl p-5"
        style={{ background: 'var(--theme-panel)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--theme-text)]">⇄ Rebalance Sister Load</h2>
          <button onClick={onClose} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] text-lg leading-none">✕</button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <label className="text-[10px] text-[var(--theme-muted)] block mb-1">From (overloaded)</label>
              <select
                value={rebalanceFrom}
                onChange={e => onFromChange(e.target.value)}
                className="w-full text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1.5 text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
              >
                <option value="">Select sister…</option>
                {sisterChips.map(([name, count]) => (
                  <option key={name} value={name}>{name} ({count})</option>
                ))}
              </select>
            </div>
            <span className="text-[var(--theme-muted)] mt-4">→</span>
            <div className="flex-1">
              <label className="text-[10px] text-[var(--theme-muted)] block mb-1">To (lighter)</label>
              <select
                value={rebalanceTo}
                onChange={e => onToChange(e.target.value)}
                className="w-full text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1.5 text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
              >
                <option value="">Select sister…</option>
                {sisterChips.map(([name, count]) => (
                  <option key={name} value={name}>{name} ({count})</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[var(--theme-muted)] block mb-1">Move up to N tasks (todo/backlog only)</label>
            <input
              type="number"
              min={1}
              max={200}
              value={rebalanceCount}
              onChange={e => onCountChange(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1.5 text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
            />
          </div>
          <button
            onClick={onConfirm}
            disabled={rebalancing || !rebalanceFrom || !rebalanceTo}
            className="w-full text-xs rounded-lg border border-[var(--theme-accent)] bg-[var(--theme-accent)]/10 px-3 py-2 text-[var(--theme-accent)] hover:bg-[var(--theme-accent)]/20 transition-colors disabled:opacity-40"
          >
            {rebalancing ? 'Moving…' : `Move ${rebalanceCount} tasks`}
          </button>
        </div>
      </div>
    </>
  )
}
