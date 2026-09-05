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
      ? 'text-[var(--theme-success)] border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)]'
      : tone === 'warn'
        ? 'text-[var(--theme-warning)] border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)]'
        : tone === 'danger'
          ? 'text-[var(--theme-danger)] border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)]'
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
