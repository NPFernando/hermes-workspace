import {
  Alert01Icon,
  ArrowRight01Icon,
  Refresh01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useDashboardRefresh } from '@/screens/dashboard/lib/dashboard-refresh-context'

export function DashboardEmptyState({
  title,
  description,
  statusLabel = 'awaiting data',
}: {
  title: string
  description: string
  statusLabel?: string
}) {
  return (
    <div
      role="group"
      aria-label={`${title}: ${statusLabel}. ${description}`}
      className="relative flex min-h-[118px] flex-col justify-center gap-2 overflow-hidden rounded-xl border px-3 py-3"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background:
            'linear-gradient(90deg, var(--theme-border), transparent)',
        }}
      />
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-[var(--theme-muted)]"
        />
        <h2 className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
          {title}
        </h2>
        <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--theme-muted)]">
          {statusLabel}
        </span>
      </div>
      <p className="pl-3.5 text-[10px] leading-relaxed text-[var(--theme-muted)]">
        {description}
      </p>
    </div>
  )
}

export function DashboardLoadingState({ title }: { title: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={`Loading ${title}`}
      className="relative flex min-h-[118px] flex-col justify-center gap-3 overflow-hidden rounded-xl border px-3 py-3"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-[var(--theme-accent)] motion-safe:animate-pulse"
        />
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
          {title}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--theme-muted)]">
          syncing
        </span>
      </div>
      <div className="space-y-1.5 pl-3.5" aria-hidden>
        <div className="h-2 w-4/5 rounded bg-[var(--theme-border)]/70 motion-safe:animate-pulse" />
        <div className="h-2 w-3/5 rounded bg-[var(--theme-border)]/50 motion-safe:animate-pulse" />
      </div>
    </div>
  )
}

export function DashboardUnavailableState({ title }: { title: string }) {
  const refreshState = useDashboardRefresh()
  const description = refreshState?.globalUnavailable
    ? 'Use Retry sync in the banner above.'
    : 'Workspace telemetry is temporarily unavailable.'

  return (
    <div
      role="group"
      aria-label={`${title}: unavailable. ${description}`}
      className="relative flex min-h-[118px] flex-col justify-center gap-2 overflow-hidden rounded-xl border px-3 py-3"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor:
          'color-mix(in srgb, var(--theme-warning) 35%, var(--theme-border))',
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-md"
          style={{
            background:
              'color-mix(in srgb, var(--theme-warning) 14%, transparent)',
            color: 'var(--theme-warning)',
          }}
        >
          <HugeiconsIcon icon={Alert01Icon} size={13} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
            {title}
          </h2>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--theme-warning)]">
            unavailable
          </span>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-2 pl-8 sm:flex-row sm:items-center sm:gap-3">
        <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-[var(--theme-muted)]">
          {description}
        </p>
        {refreshState && !refreshState.globalUnavailable ? (
          <button
            type="button"
            onClick={refreshState.refresh}
            disabled={refreshState.isRefreshing}
            aria-busy={refreshState.isRefreshing ? 'true' : undefined}
            className="inline-flex min-h-11 shrink-0 self-start items-center gap-1 rounded-md border border-[var(--theme-border)] px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] disabled:cursor-wait disabled:opacity-60 sm:self-auto lg:min-h-0"
            aria-label={`${refreshState.isRefreshing ? 'Retrying' : 'Retry'} ${title}`}
          >
            <HugeiconsIcon
              icon={Refresh01Icon}
              size={12}
              strokeWidth={1.8}
              className={
                refreshState.isRefreshing
                  ? 'motion-safe:animate-spin'
                  : undefined
              }
            />
            {refreshState.isRefreshing ? 'Retrying…' : 'Retry'}
            {!refreshState.isRefreshing ? (
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={11}
                strokeWidth={1.8}
              />
            ) : null}
          </button>
        ) : null}
      </div>
    </div>
  )
}
