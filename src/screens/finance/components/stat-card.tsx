export function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'warn' | 'danger'
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-200 border-emerald-400/25 bg-emerald-500/10'
      : tone === 'warn'
        ? 'text-amber-200 border-amber-400/25 bg-amber-500/10'
        : tone === 'danger'
          ? 'text-red-200 border-red-400/25 bg-red-500/10'
          : 'text-[var(--theme-text)] border-[var(--theme-border)] bg-[var(--theme-panel)]/70'
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.22em] text-[var(--theme-muted)]">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}
