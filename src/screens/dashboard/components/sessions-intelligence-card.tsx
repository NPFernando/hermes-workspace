import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AiGameIcon,
  Airplane01Icon,
  AlarmClockIcon,
  ArrowRight01Icon,
  Chat01Icon,
  ClipboardIcon,
  Compass01Icon,
  ComputerTerminal01Icon,
  Plug01Icon,
  Wifi01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { formatModelName } from '@/screens/dashboard/lib/formatters'

export type SessionRowData = {
  key: string
  title: string
  kind: string
  status: string
  source: string | null
  model: string | null
  messageCount: number
  toolCallCount: number
  tokenCount: number
  startedAt: number | null
  updatedAt: number | null
}

type SessionIcon = typeof Chat01Icon

const KIND_ICONS: Record<string, SessionIcon> = {
  chat: Chat01Icon,
  cron: AlarmClockIcon,
  cli: ComputerTerminal01Icon,
  api: Plug01Icon,
  api_server: Plug01Icon,
  telegram: Airplane01Icon,
  discord: AiGameIcon,
  whatsapp: Chat01Icon,
  signal: Wifi01Icon,
  imessage: Chat01Icon,
  matrix: Chat01Icon,
  workspace: Compass01Icon,
  local: Compass01Icon,
  job: ClipboardIcon,
}

/**
 * Pick the best icon for a session row by combining `kind`, `source`,
 * and a heuristic on the session key (cron sessions use the canonical
 * `cron_<jobId>_<ts>` key format the agent confirmed).
 */
function sessionGlyph(s: {
  kind: string
  source: string | null
  key: string
}): SessionIcon {
  if (typeof s.key === 'string' && s.key.startsWith('cron_')) {
    return KIND_ICONS.cron
  }
  const sourceKey = s.source?.toLowerCase()
  if (sourceKey && sourceKey in KIND_ICONS) return KIND_ICONS[sourceKey]
  const kindKey = s.kind.toLowerCase()
  if (kindKey in KIND_ICONS) return KIND_ICONS[kindKey]
  return KIND_ICONS.chat
}

function relativeTime(ms: number | null): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  if (diff < 60_000) return '<1m ago'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

function formatTokens(n: number): string {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function shortTitle(s: SessionRowData): string {
  const t = s.title.trim()
  if (t && t.length > 0 && t !== s.key) return t
  // Fall back to friendly slug from the key
  return `Session ${s.key.slice(0, 8)}`
}

type SessionBadge = {
  label: string
  tone: string
  title: string
}

function buildBadges(s: SessionRowData): Array<SessionBadge> {
  const badges: Array<SessionBadge> = []
  const now = Date.now()
  // Hot: started or updated within 5 minutes and still idle/active
  if (s.updatedAt && now - s.updatedAt < 5 * 60_000 && s.status !== 'ended') {
    badges.push({
      label: 'hot',
      tone: 'var(--theme-success)',
      title: 'Active in last 5 minutes',
    })
  }
  if (s.toolCallCount >= 20) {
    badges.push({
      label: 'tool-heavy',
      tone: 'var(--theme-accent)',
      title: `${s.toolCallCount} tool calls`,
    })
  }
  if (s.tokenCount >= 50_000) {
    badges.push({
      label: 'high-token',
      tone: 'var(--theme-accent-secondary)',
      title: `${formatTokens(s.tokenCount)} tokens`,
    })
  }
  if (
    s.status.toLowerCase() === 'error' ||
    s.status.toLowerCase() === 'failed'
  ) {
    badges.push({
      label: 'error',
      tone: 'var(--theme-danger)',
      title: 'Session ended in an error state',
    })
  }
  if (
    s.updatedAt &&
    now - s.updatedAt > 7 * 86_400_000 &&
    s.status !== 'ended'
  ) {
    badges.push({
      label: 'stale',
      tone: 'var(--theme-muted)',
      title: 'No activity in over 7 days',
    })
  }
  return badges
}

/**
 * Sessions Intelligence — replaces the legacy 14d Activity chart.
 *
 * The agent review specifically called out that Recent Sessions was
 * hex-ID dominated and useless for triage. This card surfaces the
 * meaningful signal:
 *
 * - human title (derivedTitle from /api/sessions, falling back to a
 *   short slug from the key)
 * - kind icon (chat, cron, telegram, ...)
 * - badges: hot, tool-heavy, high-token, error, stale
 * - hierarchy: model chip, msgs, tools, tokens, recency
 * - hot row gets a soft accent border so the operator sees what's
 *   running right now without scanning IDs
 *
 * Click row → navigates to /chat/<sessionKey>.
 */
export function SessionsIntelligenceCard({
  sessions,
  loading = false,
}: {
  sessions: Array<SessionRowData>
  loading?: boolean
}) {
  const enriched = useMemo(() => {
    return sessions.map((s) => ({
      session: s,
      badges: buildBadges(s),
    }))
  }, [sessions])

  // Highlight: top hot session, otherwise top tool-heavy, otherwise top recent.
  const highlightId = useMemo(() => {
    const hot = enriched.find((e) => e.badges.some((b) => b.label === 'hot'))
    if (hot) return hot.session.key
    const heavy = enriched.find((e) =>
      e.badges.some((b) => b.label === 'tool-heavy'),
    )
    if (heavy) return heavy.session.key
    return enriched[0]?.session.key ?? null
  }, [enriched])

  return (
    <div
      // h-full + flex-1 lets the card stretch to consume remaining
      // vertical space when the parent column is taller than the
      // content (e.g. when the side rail extends below). Iter 013
      // ask: 'make sessions intelligence longer to fill the gap'.
      className="relative flex h-full flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-[var(--theme-border)] p-3"
      style={{
        background:
          'linear-gradient(150deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 90%, transparent))',
      }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="min-w-0 truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-text)] md:text-[11px] md:tracking-[0.18em]">
          <span className="sm:hidden">Sessions</span>
          <span className="hidden sm:inline">Sessions intelligence</span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--theme-muted)]">
            {loading ? 'Loading…' : `${sessions.length} recent`}
          </span>
          <Link
            to="/chat/$sessionKey"
            params={{ sessionKey: 'main' }}
            className="inline-flex min-h-11 items-center gap-1 rounded border border-[var(--theme-border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
            aria-label="Open main chat"
          >
            <span>Open chat</span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={1.8}
            />
          </Link>
        </div>
      </div>

      {loading ? (
        <div
          className="flex min-h-[120px] flex-col justify-center gap-2 rounded-md border border-dashed border-[var(--theme-border)] px-4"
          aria-busy="true"
          aria-label="Loading recent sessions"
        >
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--theme-muted)]">
            <span className="size-1.5 rounded-full bg-[var(--theme-accent)] motion-safe:animate-pulse" />
            Syncing session activity
          </div>
          <div className="h-2 w-3/4 rounded bg-[var(--theme-border)]/70 motion-safe:animate-pulse" />
          <div className="h-2 w-1/2 rounded bg-[var(--theme-border)]/50 motion-safe:animate-pulse" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--theme-border)] px-4 text-center">
          <p className="text-[11px] text-[var(--theme-muted)]">
            No sessions yet
          </p>
          <p className="text-[10px] text-[var(--theme-muted)]/75">
            Start a chat to populate your activity timeline.
          </p>
          <Link
            to="/chat/$sessionKey"
            params={{ sessionKey: 'new' }}
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-[var(--theme-accent)]/40 bg-[var(--theme-accent)]/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-accent)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
          >
            <span>Start a chat</span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={1.8}
            />
          </Link>
        </div>
      ) : (
        // Iter 013: bumped from 8 → 14 rows. The card is now the
        // bottom anchor of the main column, so it has the room.
        // Operators that want fewer can still toggle to a deep
        // sessions route in iter N+1.
        <ul className="flex flex-1 flex-col gap-1 overflow-hidden">
          {enriched.slice(0, 14).map(({ session: s, badges }) => {
            const isHighlight = s.key === highlightId
            const icon = sessionGlyph(s)
            return (
              <li key={s.key}>
                <Link
                  to="/chat/$sessionKey"
                  params={{ sessionKey: s.key }}
                  aria-label={`Open session ${shortTitle(s)}`}
                  className="group flex min-h-11 w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)]"
                  style={{
                    borderColor: isHighlight
                      ? 'color-mix(in srgb, var(--theme-accent) 50%, transparent)'
                      : 'var(--theme-border)',
                    background: isHighlight
                      ? 'color-mix(in srgb, var(--theme-accent) 6%, transparent)'
                      : 'transparent',
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-flex shrink-0 text-[var(--theme-muted)]"
                    style={{ filter: isHighlight ? 'none' : 'grayscale(0.2)' }}
                  >
                    <HugeiconsIcon icon={icon} size={15} strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-[12px] font-semibold text-[var(--theme-text)]"
                        title={s.title}
                      >
                        {shortTitle(s)}
                      </span>
                      {badges.map((b) => (
                        <span
                          key={b.label}
                          className="hidden shrink-0 rounded px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] sm:inline-block"
                          style={{
                            background: `color-mix(in srgb, ${b.tone} 14%, transparent)`,
                            color: b.tone,
                            border: `1px solid color-mix(in srgb, ${b.tone} 32%, transparent)`,
                          }}
                          title={b.title}
                        >
                          {b.label}
                        </span>
                      ))}
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--theme-muted)]">
                      {s.model ? (
                        <span
                          className="min-w-0 max-w-[9rem] truncate rounded px-1 py-0.5"
                          style={{
                            background:
                              'color-mix(in srgb, var(--theme-accent) 10%, transparent)',
                            color: 'var(--theme-accent)',
                          }}
                        >
                          {formatModelName(s.model)}
                        </span>
                      ) : null}
                      <span>{s.messageCount} msgs</span>
                      {s.toolCallCount > 0 ? (
                        <span>{s.toolCallCount} tools</span>
                      ) : null}
                      {s.tokenCount > 0 ? (
                        <span>{formatTokens(s.tokenCount)} tok</span>
                      ) : null}
                      <span className="ml-auto shrink-0">
                        {relativeTime(s.updatedAt ?? s.startedAt)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
