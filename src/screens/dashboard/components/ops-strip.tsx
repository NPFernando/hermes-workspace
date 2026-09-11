import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Refresh01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { MouseEvent } from 'react'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { cn } from '@/lib/utils'
import { CHANGELOG } from '@/lib/changelog'
import { useDashboardRefresh } from '@/screens/dashboard/lib/dashboard-refresh-context'

const SEEN_KEY = 'hermes-workspace-seen-version'

function formatPulse(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  if (diff < 60_000) return '<1m ago'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

const STATE_TONE: Record<string, string> = {
  connected: 'var(--theme-success)',
  running: 'var(--theme-success)',
  ok: 'var(--theme-success)',
  connecting: 'var(--theme-warning)',
  starting: 'var(--theme-warning)',
  error: 'var(--theme-danger)',
  disconnected: 'var(--theme-danger)',
  failed: 'var(--theme-danger)',
}

function platformTone(state: string): string {
  return STATE_TONE[state.toLowerCase()] ?? 'var(--theme-muted)'
}

function formatNextRun(iso: string | null): {
  text: string
  tone: string
} {
  if (!iso) return { text: 'no schedule', tone: 'var(--theme-muted)' }
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms))
    return { text: 'no schedule', tone: 'var(--theme-muted)' }
  const diff = ms - Date.now()
  if (diff < -7 * 86_400_000) {
    return { text: 'stale', tone: 'var(--theme-muted)' }
  }
  if (diff < 0) return { text: 'overdue', tone: 'var(--theme-warning)' }
  if (diff < 60_000) return { text: '<1m', tone: 'var(--theme-text)' }
  if (diff < 3_600_000)
    return { text: `${Math.round(diff / 60_000)}m`, tone: 'var(--theme-text)' }
  if (diff < 86_400_000)
    return {
      text: `${Math.round(diff / 3_600_000)}h`,
      tone: 'var(--theme-text)',
    }
  return {
    text: `${Math.round(diff / 86_400_000)}d`,
    tone: 'var(--theme-text)',
  }
}

/**
 * Consolidated operations strip — the "10-second status read" the
 * dashboard spec calls for. Replaces three separate stacked rows
 * (system status, cron summary, platforms grid) with one tight
 * horizontal bar that surfaces gateway state, version drift, cron
 * pulse, and platform pills in a single line.
 *
 * Renders nothing if there is no status (overview hasn't loaded /
 * gateway is unreachable) so the dashboard does not flash an empty
 * frame on first paint.
 */
export function OpsStrip({
  status,
  cron,
  kanban,
  platforms,
  unavailable = false,
}: {
  status: DashboardOverview['status']
  cron: DashboardOverview['cron']
  kanban: DashboardOverview['kanban']
  platforms: DashboardOverview['platforms']
  unavailable?: boolean
}) {
  const navigate = useNavigate()
  const refreshState = useDashboardRefresh()
  const [hasUnread, setHasUnread] = useState(false)

  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY)
      setHasUnread(seen !== CHANGELOG[0].version)
    } catch {
      // Release-note status is best-effort when storage is restricted.
      setHasUnread(true)
    }
  }, [])

  const openReleaseNotes = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    setHasUnread(false)
    try {
      localStorage.setItem(SEEN_KEY, CHANGELOG[0].version)
    } catch {
      // Navigation should still work when storage is restricted.
    }
    navigate({ to: '/settings', search: { section: 'whatsnew' } })
  }

  if (!status) {
    if (!unavailable) return null
    return (
      <section
        aria-label="Workspace operations status unavailable"
        role="status"
        className="surface-card card-glow flex items-center gap-3 rounded-md border bg-[var(--theme-card)]/50 px-3 py-2 text-[11px] border-[var(--theme-border)]"
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-[var(--theme-warning)]"
        />
        <span className="min-w-0 flex-1 font-mono uppercase tracking-[0.12em] text-[var(--theme-muted)]">
          Workspace operations status is temporarily unavailable.
        </span>
        {refreshState ? (
          <button
            type="button"
            onClick={refreshState.refresh}
            disabled={refreshState.isRefreshing}
            aria-busy={refreshState.isRefreshing ? 'true' : undefined}
            aria-label={
              refreshState.isRefreshing
                ? 'Retrying workspace telemetry'
                : 'Retry workspace telemetry'
            }
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded border border-[var(--theme-border)] px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] disabled:cursor-wait disabled:opacity-60 lg:min-h-0"
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
            {refreshState.isRefreshing ? 'Retrying…' : 'Retry sync'}
          </button>
        ) : null}
      </section>
    )
  }

  const ok =
    status.gatewayState === 'running' ||
    status.gatewayState === 'connected' ||
    status.gatewayState === 'ok'
  const isConnecting = ['connecting', 'starting'].includes(
    status.gatewayState.toLowerCase(),
  )

  const drift =
    status.configVersion !== null &&
    status.latestConfigVersion !== null &&
    status.latestConfigVersion > status.configVersion
      ? status.latestConfigVersion - status.configVersion
      : 0

  const next = cron ? formatNextRun(cron.nextRunAt) : null

  return (
    <section
      aria-label="Workspace operations status"
      className="surface-card card-glow flex flex-col gap-1.5 rounded-md border bg-[var(--theme-card)]/50 px-3 py-2 max-[639px]:gap-1 border-[var(--theme-border)] lg:flex-row lg:items-center lg:justify-between lg:gap-4"
    >
      {/* Gateway block: state + version + active agents */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:gap-3">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex h-1.5 w-1.5 rounded-full',
              isConnecting ? 'motion-safe:animate-pulse' : '',
            )}
            style={{
              background: ok ? 'var(--theme-success)' : 'var(--theme-warning)',
            }}
          />
          <span className="font-mono uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            {ok ? 'gateway' : `gateway ${status.gatewayState}`}
          </span>
        </span>
        {status.version ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--theme-muted)]">
            v{status.version}
          </span>
        ) : null}
        <span className="font-mono uppercase tracking-[0.15em] text-[var(--theme-muted)]">
          <span aria-hidden className="hidden sm:inline">
            ·{' '}
          </span>
          <span className="sm:hidden">
            {status.activeAgents} {status.activeAgents === 1 ? 'run' : 'runs'}
          </span>
          <span className="hidden sm:inline">
            {status.activeAgents} active{' '}
            {status.activeAgents === 1 ? 'run' : 'runs'}
          </span>
        </span>
        {status.lastHeartbeatAt ? (
          <span
            className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--theme-muted)]"
            title={`Last gateway heartbeat: ${status.lastHeartbeatAt}`}
          >
            <span aria-hidden className="hidden sm:inline">
              ·{' '}
            </span>
            <span className="sm:hidden">
              {formatPulse(status.lastHeartbeatAt)}
            </span>
            <span className="hidden sm:inline">
              pulse {formatPulse(status.lastHeartbeatAt)}
            </span>
          </span>
        ) : null}
        {status.restartRequested ? (
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em]"
            style={{
              background:
                'color-mix(in srgb, var(--theme-warning) 15%, transparent)',
              color: 'var(--theme-warning)',
              border:
                '1px solid color-mix(in srgb, var(--theme-warning) 35%, transparent)',
            }}
          >
            restart pending
          </span>
        ) : null}
        {drift > 0 ? (
          <Link
            to="/settings"
            search={{}}
            aria-label={`Open Settings: ${drift} configuration difference${drift === 1 ? '' : 's'} detected`}
            className="inline-flex min-h-11 items-center rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-warning)] focus-visible:ring-inset lg:min-h-0"
            style={{
              background:
                'color-mix(in srgb, var(--theme-warning) 12%, transparent)',
              color: 'var(--theme-warning)',
              border:
                '1px solid color-mix(in srgb, var(--theme-warning) 30%, transparent)',
            }}
            title={`Local config v${status.configVersion} · latest v${status.latestConfigVersion}`}
          >
            {drift} config diff{drift === 1 ? '' : 's'}
          </Link>
        ) : null}
      </div>

      {/* Platform pills + cron next-run */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] max-[359px]:grid max-[359px]:grid-cols-2 max-[359px]:justify-items-start max-[639px]:gap-x-1 min-[640px]:max-[1023px]:grid min-[640px]:max-[1023px]:grid-cols-2 min-[640px]:max-[1023px]:justify-items-start sm:gap-2">
        {platforms.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-[639px]:contents">
            {platforms.map((platform) => (
              <span
                key={platform.name}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-[var(--theme-border)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]"
                style={{ color: platformTone(platform.state) }}
                aria-label={`${platform.name.replace('_', ' ')}: ${platform.state}${platform.errorMessage ? `, ${platform.errorMessage}` : ''}`}
                title={
                  platform.errorMessage
                    ? `${platform.name}: ${platform.errorMessage}`
                    : `${platform.name} · ${platform.state}`
                }
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: platformTone(platform.state) }}
                />
                {platform.name.replace('_', ' ')}
                <span className="text-[8px] normal-case tracking-[0.04em] opacity-75 max-[639px]:hidden">
                  · {platform.state}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {kanban ? (
          <Link
            to="/swarm2"
            aria-label={`Open Kanban board: ${kanban.total} total, ${kanban.ready} ready, ${kanban.running} running, ${kanban.blocked} blocked`}
            className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset text-[var(--theme-muted)] max-[639px]:px-1.5 lg:min-h-0"
            style={{
              borderColor:
                kanban.blocked > 0
                  ? 'color-mix(in srgb, var(--theme-warning) 35%, transparent)'
                  : 'var(--theme-border)',
              background:
                kanban.blocked > 0
                  ? 'color-mix(in srgb, var(--theme-warning) 10%, transparent)'
                  : 'transparent',
            }}
            title="Open Kanban board"
          >
            <span>board</span>
            <span className="text-[var(--theme-text)]">{kanban.total}</span>
            {kanban.ready > 0 ? (
              <span className="hidden text-[var(--theme-text)] sm:inline">
                · {kanban.ready} ready
              </span>
            ) : null}
            {kanban.running > 0 ? (
              <span className="hidden text-[var(--theme-success,#50fa7b)] sm:inline">
                · {kanban.running} running
              </span>
            ) : null}
            {kanban.blocked > 0 ? (
              <span className="hidden text-[var(--theme-warning)] sm:inline">
                · {kanban.blocked} blocked
              </span>
            ) : null}
          </Link>
        ) : null}

        {cron
          ? (() => {
              const isStale = next?.text === 'stale'
              const isWarn = next?.text === 'overdue' || isStale
              return (
                <Link
                  to="/jobs"
                  aria-label={`Open cron jobs: ${cron.total} total, ${cron.paused} paused, ${cron.running} running${next ? `; next run ${next.text}` : ''}`}
                  className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset text-[var(--theme-muted)] max-[639px]:px-1.5 lg:min-h-0"
                  style={{
                    borderColor: isWarn
                      ? 'color-mix(in srgb, var(--theme-warning) 35%, transparent)'
                      : 'var(--theme-border)',
                    background: isWarn
                      ? 'color-mix(in srgb, var(--theme-warning) 10%, transparent)'
                      : 'transparent',
                  }}
                  title={
                    isStale
                      ? 'Cron next-run is more than 7 days overdue'
                      : 'Open cron jobs'
                  }
                >
                  <span>cron</span>
                  <span className="text-[var(--theme-text)]">{cron.total}</span>
                  {cron.paused > 0 ? (
                    <span className="hidden text-[var(--theme-warning)] sm:inline">
                      · {cron.paused} paused
                    </span>
                  ) : null}
                  {cron.running > 0 ? (
                    <span className="hidden text-[var(--theme-success,#50fa7b)] sm:inline">
                      · {cron.running} running
                    </span>
                  ) : null}
                  {next ? (
                    <span
                      className="hidden sm:inline"
                      style={{ color: next.tone }}
                    >
                      · {next.text}
                    </span>
                  ) : null}
                </Link>
              )
            })()
          : null}

        {/* Workspace version + What's New */}
        <a
          href="/settings?section=whatsnew"
          onClick={openReleaseNotes}
          aria-label={
            hasUnread
              ? "Open What's New: unread release notes"
              : 'Open release notes'
          }
          className={cn(
            'inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset max-[639px]:order-first max-[639px]:px-1.5 lg:min-h-0',
            hasUnread
              ? 'border-[var(--theme-accent)]/40 text-[var(--theme-accent)]'
              : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-accent)]',
          )}
          title={hasUnread ? "What's New — unread" : 'View release notes'}
        >
          {hasUnread && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)] motion-safe:animate-pulse" />
          )}
          <span className="sm:hidden">new</span>
          <span className="hidden sm:inline">What&apos;s new</span>
          <span className="text-[var(--theme-accent)]">
            v{CHANGELOG[0].version}
          </span>
        </a>
      </div>
    </section>
  )
}
