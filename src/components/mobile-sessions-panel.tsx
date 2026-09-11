import { useEffect, useId, useRef } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Cancel01Icon, Chat01Icon } from '@hugeicons/core-free-icons'
import type { SessionMeta } from '@/screens/chat/types'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onClose: () => void
  sessions: Array<SessionMeta>
  activeFriendlyId: string
  onSelectSession: (key: string) => void
  onNewChat: () => void
}

function normalizeLabel(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : ''
}

function getSessionTitle(session: SessionMeta): string {
  const label = normalizeLabel(session.label)
  if (label) return label
  const derivedTitle = normalizeLabel(session.derivedTitle)
  if (derivedTitle) return derivedTitle
  const title = normalizeLabel(session.title)
  if (title) return title
  return `Session ${session.friendlyId.slice(0, 8)}`
}

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function formatUpdatedAt(updatedAt?: number): string {
  if (typeof updatedAt !== 'number') return ''
  const value = new Date(updatedAt)
  const now = new Date()
  if (value.toDateString() === now.toDateString()) {
    return timeFormatter.format(value)
  }
  return dayFormatter.format(value)
}

export function MobileSessionsPanel({
  open,
  onClose,
  sessions,
  activeFriendlyId,
  onSelectSession,
  onNewChat,
}: Props) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (active === last || !panel.contains(active))
      ) {
        event.preventDefault()
        first.focus()
      }
    }

    const focusTimer = requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(focusTimer)
      window.removeEventListener('keydown', handleKeyDown)
      const previous = previousFocusRef.current
      if (previous?.isConnected) {
        previous.focus()
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[97] no-swipe md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        aria-label="Dismiss sessions panel"
        onClick={onClose}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="no-swipe absolute inset-y-0 left-0 w-[80vw] max-w-sm border-r shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-left-8 motion-safe:duration-200"
        style={{
          background: 'var(--theme-panel)',
          borderColor: 'var(--theme-border)',
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4 py-3">
            <h2
              id={titleId}
              className="text-sm font-semibold text-[var(--theme-text)]"
            >
              Sessions
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onNewChat}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2.5 py-1.5 text-xs font-medium text-[var(--theme-muted)] motion-safe:transition-colors hover:border-[var(--theme-accent-border)] hover:text-[var(--theme-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]"
              >
                <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.8} />
                New Chat
              </button>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close sessions panel"
                className="inline-flex size-11 items-center justify-center rounded-lg text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={17}
                  strokeWidth={1.7}
                />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-[var(--theme-muted)]">
                <HugeiconsIcon icon={Chat01Icon} size={24} strokeWidth={1.6} />
                <p className="text-sm">No sessions yet.</p>
                <p className="text-xs text-[var(--theme-muted)]">
                  Start a conversation to see it here.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => {
                  const active = session.friendlyId === activeFriendlyId
                  const timestamp = formatUpdatedAt(session.updatedAt)
                  return (
                    <button
                      key={session.key}
                      type="button"
                      onClick={() => onSelectSession(session.friendlyId)}
                      className={cn(
                        'min-h-11 w-full rounded-lg border px-3 py-2 text-left motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)]',
                        active
                          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)]'
                          : 'border-transparent bg-[var(--theme-panel)] hover:border-[var(--theme-border)] hover:bg-[var(--theme-card)]',
                      )}
                    >
                      <div className="truncate text-sm font-medium text-[var(--theme-text)]">
                        {getSessionTitle(session)}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-[var(--theme-muted)]">
                        <span className="truncate">{session.friendlyId}</span>
                        {timestamp ? <span>{timestamp}</span> : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
