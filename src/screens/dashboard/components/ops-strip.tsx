import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { cn } from '@/lib/utils'
import { CHANGELOG } from '@/lib/changelog'

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

const PLATFORM_GLYPH: Record<string, string> = {
  api_server: '🌐',
  telegram: '✈️',
  discord: '🎮',
  whatsapp: '🟢',
  slack: '💼',
  signal: '🔵',
  matrix: '#',
  nostr: '⚡',
  imessage: '💬',
  bluebubbles: '🫧',
  mattermost: '🔷',
  feishu: '🪶',
  line: '💚',
  zalo: '⭐',
  twitch: '🎬',
  qqbot: '🐧',
  msteams: '🟦',
  irc: '#',
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
  if (!Number.isFinite(ms)) return { text: 'no schedule', tone: 'var(--theme-muted)' }
  const diff = ms - Date.now()
  if (diff < -7 * 86_400_000) {
    return { text: 'stale', tone: 'var(--theme-muted)' }
  }
  if (diff < 0) return { text: 'overdue', tone: 'var(--theme-warning)' }
  if (diff < 60_000) return { text: '<1m', tone: 'var(--theme-text)' }
  if (diff < 3_600_000)
    return { text: `${Math.round(diff / 60_000)}m`, tone: 'var(--theme-text)' }
  if (diff < 86_400_000)
    return { text: `${Math.round(diff / 3_600_000)}h`, tone: 'var(--theme-text)' }
  return { text: `${Math.round(diff / 86_400_000)}d`, tone: 'var(--theme-text)' }
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
}: {
  status: DashboardOverview['status']
  cron: DashboardOverview['cron']
  kanban: DashboardOverview['kanban']
  platforms: DashboardOverview['platforms']
}) {
  const navigate = useNavigate()
  const [hasUnread, setHasUnread] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem(SEEN_KEY)
    setHasUnread(seen !== CHANGELOG[0].version)
  }, [])

  if (!status) return null

  const ok =
    status.gatewayState === 'running' ||
    status.gatewayState === 'connected' ||
    status.gatewayState === 'ok'

  const drift =
    status.configVersion !== null &&
    status.latestConfigVersion !== null &&
    status.latestConfigVersion > status.configVersion
      ? status.latestConfigVersion - status.configVersion
      : 0

  const next = cron ? formatNextRun(cron.nextRunAt) : null

  return (
    <div
      className="flex flex-col gap-2 rounded-md border bg-[var(--theme-card)]/50 px-3 py-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4 border-[var(--theme-border)]"
    >
      {/* Gateway block: state + version + active agents */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex h-1.5 w-1.5 rounded-full',
              ok ? 'animate-pulse' : '',
            )}
            style={{
              background: ok
                ? 'var(--theme-success)'
                : 'var(--theme-warning)',
            }}
          />
          <span
            className="font-mono uppercase tracking-[0.15em] text-[var(--theme-muted)]"
          >
            {ok ? 'gateway' : `gateway ${status.gatewayState}`}
          </span>
        </span>
        {status.version ? (
          <span
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--theme-muted)]"
          >
            v{status.version}
          </span>
        ) : null}
        <span
          className="font-mono uppercase tracking-[0.15em] text-[var(--theme-muted)]"
        >
          · {status.activeAgents} active{' '}
          {status.activeAgents === 1 ? 'run' : 'runs'}
        </span>
        {status.lastHeartbeatAt ? (
          <span
            className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--theme-muted)]"
            title={`Last gateway heartbeat: ${status.lastHeartbeatAt}`}
          >
            · pulse {formatPulse(status.lastHeartbeatAt)}
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
          <button
            type="button"
            onClick={() => navigate({ to: '/settings', search: {} })}
            className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] transition-colors hover:bg-[var(--theme-card)]/80"
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
          </button>
        ) : null}
      </div>

      {/* Platform pills + cron next-run */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {platforms.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {platforms.map((platform) => (
              <span
                key={platform.name}
                className="inline-flex items-center gap-1 rounded border border-[var(--theme-border)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]"
                style={{ color: platformTone(platform.state) }}
                title={
                  platform.errorMessage
                    ? `${platform.name}: ${platform.errorMessage}`
                    : `${platform.name} · ${platform.state}`
                }
              >
                <span aria-hidden>
                  {PLATFORM_GLYPH[platform.name] ?? '🔌'}
                </span>
                {platform.name.replace('_', ' ')}
              </span>
            ))}
          </div>
        ) : null}

        {kanban ? (
          <button
            type="button"
            onClick={() => navigate({ to: '/swarm2' })}
            className="inline-flex items-center gap-2 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors hover:bg-[var(--theme-card)]/80 text-[var(--theme-muted)]"
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
              <span className="text-[var(--theme-text)]">· {kanban.ready} ready</span>
            ) : null}
            {kanban.running > 0 ? (
              <span className="text-[var(--theme-success,#50fa7b)]">
                · {kanban.running} running
              </span>
            ) : null}
            {kanban.blocked > 0 ? (
              <span className="text-amber-400">
                · {kanban.blocked} blocked
              </span>
            ) : null}
          </button>
        ) : null}

        {cron ? (() => {
          const isStale = next?.text === 'stale'
          const isWarn = next?.text === 'overdue' || isStale
          return (
            <button
              type="button"
              onClick={() => navigate({ to: '/jobs' })}
              className="inline-flex items-center gap-2 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors hover:bg-[var(--theme-card)]/80 text-[var(--theme-muted)]"
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
                <span className="text-amber-400">
                  · {cron.paused} paused
                </span>
              ) : null}
              {cron.running > 0 ? (
                <span className="text-[var(--theme-success,#50fa7b)]">
                  · {cron.running} running
                </span>
              ) : null}
              {next ? (
                <span style={{ color: next.tone }}>· {next.text}</span>
              ) : null}
            </button>
          )
        })() : null}

        {/* Workspace version + What's New */}
        <button
          type="button"
          onClick={() => { setHasUnread(false); navigate({ to: '/settings', search: { section: 'whatsnew' } }) }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors hover:bg-[var(--theme-card)]/80',
            hasUnread
              ? 'border-[var(--theme-accent)]/40 text-[var(--theme-accent)]'
              : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-accent)]',
          )}
          title={hasUnread ? "What's New — unread" : 'View release notes'}
        >
          {hasUnread && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)] animate-pulse" />
          )}
          <span>ws</span>
          <span className="text-[var(--theme-accent)]">v{CHANGELOG[0].version}</span>
        </button>
      </div>
    </div>
  )
}
