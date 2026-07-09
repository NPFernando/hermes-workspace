import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  BrainIcon,
  Chat01Icon,
  Clock01Icon,
  CodeIcon,
  PencilEdit02Icon,
  PuzzleIcon,
} from '@hugeicons/core-free-icons'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { SessionMeta } from '../types'
import { formatModelName } from '@/lib/format-model-name'

type ProfileSummary = {
  name: string
  model?: string
  active?: boolean
}

type SuggestionChip = {
  label: string
  prompt: string
  icon: unknown
}

const SUGGESTIONS: Array<SuggestionChip> = [
  {
    label: 'Workspace risks',
    prompt:
      'Analyze this workspace structure and give me 3 engineering risks. Use tools and keep it concise.',
    icon: CodeIcon,
  },
  {
    label: 'Save preference',
    prompt:
      'Save this to memory exactly: "For demos, respond in 3 bullets max and put risk first." Then confirm saved.',
    icon: BrainIcon,
  },
  {
    label: 'Create checklist',
    prompt: 'Create demo-checklist.md with 5 launch checks for this app.',
    icon: PuzzleIcon,
  },
]

type ChatEmptyStateProps = {
  onSuggestionClick?: (prompt: string) => void
  onOpenSession?: (sessionKey: string) => void
  onStartBlank?: () => void
  recentSessions?: Array<SessionMeta>
  compact?: boolean
  /** Resolved runtime model (same chain as the composer button) — the
   *  profile's configured `model` field can be stale, so never show it. */
  runtimeModel?: string
}

function getSessionLabel(session: SessionMeta) {
  return (
    session.label ||
    session.title ||
    session.derivedTitle ||
    session.friendlyId ||
    session.key
  )
}

function getSessionPreview(session: SessionMeta) {
  return session.preview || 'Recent chat'
}

function formatSessionAge(updatedAt?: number) {
  if (!updatedAt) return ''
  const timestamp = updatedAt > 10_000_000_000 ? updatedAt : updatedAt * 1000
  const diffMs = Date.now() - timestamp
  if (!Number.isFinite(diffMs) || diffMs < 0) return ''
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

export function ChatEmptyState({
  onSuggestionClick,
  onOpenSession,
  onStartBlank,
  recentSessions = [],
  compact = false,
  runtimeModel,
}: ChatEmptyStateProps) {
  const [activeProfile, setActiveProfile] = useState<ProfileSummary | null>(null)
  const visibleRecentSessions = useMemo(
    () =>
      [...recentSessions]
        .filter((session) => session.key !== 'new' && session.friendlyId !== 'new')
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .slice(0, compact ? 2 : 3),
    [compact, recentSessions],
  )

  useEffect(() => {
    fetch('/api/profiles/list')
      .then((res) => res.json())
      .then((data) => {
        const profiles = data?.profiles as Array<ProfileSummary> | undefined
        const active = profiles?.find((p) => p.active)
        if (active) setActiveProfile(active)
      })
      .catch(() => {
        // silently ignore — profile info is cosmetic
      })
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex h-full flex-col items-center justify-center px-4 py-8"
    >
      <div className="flex w-full max-w-3xl flex-col items-center text-center">
        <div className="relative mb-5">
          <img
            src="/claude-avatar.webp"
            alt="Hermes Agent"
            className="relative size-20 rounded-md border border-[var(--theme-border)] p-1 bg-[var(--theme-card)]"
          />
        </div>

        <p className="micro-label mb-2">Hermes Workspace</p>

        <h2 className="editorial-display text-3xl text-[var(--theme-text)]">
          Session Launch
        </h2>

        <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs">
          {activeProfile ? (
            <span className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-card)] px-2.5 py-1 text-[var(--theme-accent)]">
              {activeProfile.name}
            </span>
          ) : null}
          {runtimeModel ? (
            <span className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-card)] px-2.5 py-1 text-[var(--theme-muted)]">
              {formatModelName(runtimeModel)}
            </span>
          ) : null}
        </div>

        {!compact && (
          <p className="mt-3 text-sm text-[var(--theme-muted)]">
            Agent chat · live tools · memory · full observability
          </p>
        )}

        <div className="mt-6 grid w-full gap-3 md:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-left">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">
                <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.5} />
                Recent
              </div>
              {onStartBlank ? (
                <button
                  type="button"
                  onClick={onStartBlank}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--theme-text)] transition-colors hover:border-[var(--theme-accent-border)] hover:bg-[var(--theme-card2)]"
                >
                  <HugeiconsIcon
                    icon={PencilEdit02Icon}
                    size={13}
                    strokeWidth={1.5}
                  />
                  Blank
                </button>
              ) : null}
            </div>
            <div className="space-y-1.5">
              {visibleRecentSessions.length > 0 ? (
                visibleRecentSessions.map((session) => {
                  const age = formatSessionAge(session.updatedAt)
                  return (
                    <button
                      key={session.key}
                      type="button"
                      onClick={() => onOpenSession?.(session.key)}
                      className="group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--theme-card2)]"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-accent)]">
                        <HugeiconsIcon
                          icon={Chat01Icon}
                          size={15}
                          strokeWidth={1.5}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-[var(--theme-text)]">
                            {getSessionLabel(session)}
                          </span>
                          {age ? (
                            <span className="shrink-0 text-[11px] text-[var(--theme-muted)]">
                              {age}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--theme-muted)]">
                          {getSessionPreview(session)}
                        </span>
                      </span>
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        size={14}
                        strokeWidth={1.5}
                        className="shrink-0 text-[var(--theme-muted)] opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </button>
                  )
                })
              ) : (
                <div className="rounded-md border border-dashed border-[var(--theme-border)] px-3 py-5 text-center text-sm text-[var(--theme-muted)]">
                  No recent sessions
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-left">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">
              <HugeiconsIcon icon={PuzzleIcon} size={14} strokeWidth={1.5} />
              Starters
            </div>
            <div className="grid gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => onSuggestionClick?.(suggestion.prompt)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors text-[var(--theme-text)] hover:bg-[var(--theme-card2)]"
                >
                  <HugeiconsIcon
                    icon={suggestion.icon as any}
                    size={14}
                    strokeWidth={1.5}
                    className="shrink-0 text-[var(--theme-accent)]"
                  />
                  <span className="min-w-0 truncate">{suggestion.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </motion.div>
  )
}
