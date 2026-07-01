export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(360px,92vw)] rounded-xl border border-[var(--theme-border)] shadow-2xl p-5"
        style={{ background: 'var(--theme-panel)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--theme-text)]">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] text-lg leading-none">✕</button>
        </div>
        <div className="flex flex-col gap-2">
          {([
            ['n', 'New task'],
            ['/', 'Focus search (operators: assignee: tag: is:)'],
            ['?', 'Toggle shortcuts panel'],
            ['Esc', 'Close panels'],
          ] as Array<[string, string]>).map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-[var(--theme-muted)]">{desc}</span>
              <kbd className="text-[11px] font-mono px-2 py-0.5 rounded border border-[var(--theme-border)] bg-[var(--theme-hover)] text-[var(--theme-text)]">{key}</kbd>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-[var(--theme-border)]">
            <p className="text-[10px] text-[var(--theme-muted)] opacity-50">Shortcuts are disabled when typing in a text field.</p>
          </div>
        </div>
      </div>
    </>
  )
}
