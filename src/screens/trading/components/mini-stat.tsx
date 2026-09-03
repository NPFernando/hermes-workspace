export function MiniStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'bad'
}) {
  const cls =
    tone === 'good'
      ? 'text-[var(--theme-success)]'
      : tone === 'bad'
        ? 'text-[var(--theme-danger)]'
        : 'text-[var(--theme-text)]'
  return (
    <div className="rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-2.5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  )
}
