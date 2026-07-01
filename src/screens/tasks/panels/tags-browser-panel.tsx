export function TagsBrowserPanel({
  tagCloud,
  tagFilter,
  onSelectTag,
  onClose,
  selectedCount,
  bulkTagValue,
  onBulkTagValueChange,
  onBulkTagSubmit,
  taggingSelected,
}: {
  tagCloud: Record<string, number>
  tagFilter: string | null
  onSelectTag: (tag: string | null) => void
  onClose: () => void
  selectedCount: number
  bulkTagValue: string
  onBulkTagValueChange: (value: string) => void
  onBulkTagSubmit: () => void
  taggingSelected: boolean
}) {
  const entries = Object.entries(tagCloud).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(...Object.values(tagCloud), 1)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[min(320px,92vw)] flex flex-col border-l border-[var(--theme-border)] shadow-2xl"
        style={{ background: 'var(--theme-panel)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border)]">
          <h2 className="text-sm font-semibold text-[var(--theme-text)]"># Tags</h2>
          <button onClick={onClose} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] text-lg leading-none">✕</button>
        </div>
        {selectedCount > 0 && (
          <div className="px-4 py-3 border-b border-[var(--theme-border)] bg-[var(--theme-hover)]">
            <p className="text-[10px] text-[var(--theme-muted)] mb-1.5">{selectedCount} tasks selected — add tag:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={bulkTagValue}
                onChange={e => onBulkTagValueChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onBulkTagSubmit() }}
                placeholder="tag name… Enter"
                disabled={taggingSelected}
                className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2.5 py-1.5 text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)] placeholder:text-[var(--theme-muted)]"
              />
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4">
          <div className="flex flex-col gap-1.5">
            {entries.map(([tag, count]) => {
              const isActive = tagFilter === tag
              return (
                <div key={tag} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectTag(isActive ? null : tag)}
                    className="flex-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--theme-hover)] text-left"
                    style={isActive ? { background: 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' } : {}}
                  >
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--theme-hover)] overflow-hidden">
                      <div className="h-full rounded-full bg-[var(--theme-accent)] opacity-60" style={{ width: `${(count / maxCount) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-[var(--theme-muted)] shrink-0 w-28 truncate">#{tag}</span>
                    <span className="text-[11px] font-medium text-[var(--theme-text)] shrink-0 w-8 text-right">{count}</span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
