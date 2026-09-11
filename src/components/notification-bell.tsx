'use client'

import { Notification03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'

import type { CenterNotification } from '@/stores/notification-center-store'

import { cn } from '@/lib/utils'
import { Z_LAYER } from '@/lib/z-layers'
import {
  useNotificationCenterStore,
  useUnreadCount,
} from '@/stores/notification-center-store'

const CATEGORY_LABEL: Record<CenterNotification['category'], string> = {
  updates: 'Update',
  changelog: "What's new",
  system: 'System',
}

function relativeTime(timestamp: number): string {
  const deltaMinutes = Math.round((Date.now() - timestamp) / 60_000)
  if (deltaMinutes < 1) return 'just now'
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours}h ago`
  return `${Math.round(deltaHours / 24)}d ago`
}

function InboxItem({ item }: { item: CenterNotification }) {
  const markRead = useNotificationCenterStore((s) => s.markRead)
  const openDigest = useNotificationCenterStore((s) => s.openDigest)

  const activate = () => {
    markRead(item.id)
    if (item.action === 'open-update-digest') openDigest()
  }

  return (
    <button
      type="button"
      onClick={activate}
      className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left motion-safe:transition-colors hover:bg-[var(--theme-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset"
    >
      <span
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          item.read ? 'bg-transparent' : 'bg-[var(--theme-accent)]',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'truncate text-sm',
              item.read
                ? 'text-[var(--theme-muted)]'
                : 'font-semibold text-[var(--theme-text)]',
            )}
          >
            {item.title}
          </span>
          <span className="shrink-0 rounded-full bg-[var(--theme-card2)] px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)]">
            {CATEGORY_LABEL[item.category]}
          </span>
        </span>
        {item.body && (
          <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--theme-muted)]">
            {item.body}
          </span>
        )}
        <span className="mt-1 block text-[10px] text-[var(--theme-muted)]">
          {relativeTime(item.createdAt)}
        </span>
      </span>
    </button>
  )
}

/**
 * Floating notification bell + inbox panel. Appears only while there are
 * unread items (or the panel is open) so an empty inbox adds zero clutter.
 * Mounted globally by NotificationHub.
 */
export function NotificationBell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const unread = useUnreadCount()
  const items = useNotificationCenterStore((s) => s.items)
  const panelOpen = useNotificationCenterStore((s) => s.panelOpen)
  const setPanelOpen = useNotificationCenterStore((s) => s.setPanelOpen)
  const markAllRead = useNotificationCenterStore((s) => s.markAllRead)
  const clearAll = useNotificationCenterStore((s) => s.clearAll)
  const [dashboardScrolled, setDashboardScrolled] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const panelTitleId = useId().replace(/:/g, '')
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!panelOpen) return undefined

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const focusFrame = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      ;(first ?? panelRef.current)?.focus()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setPanelOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      const previous = previousFocusRef.current
      if (previous?.isConnected) previous.focus()
      previousFocusRef.current = null
    }
  }, [panelOpen, setPanelOpen])

  useEffect(() => {
    if (pathname !== '/dashboard' || typeof document === 'undefined') {
      setDashboardScrolled(false)
      return
    }

    let observer: MutationObserver | null = null
    let detach: (() => void) | null = null

    const attach = (): boolean => {
      const candidate = document.querySelector('main[data-tour="chat-area"]')
      if (!(candidate instanceof HTMLElement)) return false
      const update = () => setDashboardScrolled(candidate.scrollTop > 24)
      update()
      candidate.addEventListener('scroll', update, { passive: true })
      detach = () => candidate.removeEventListener('scroll', update)
      observer?.disconnect()
      observer = null
      return true
    }

    if (!attach()) {
      observer = new MutationObserver(attach)
      observer.observe(document.body, { childList: true, subtree: true })
    }

    return () => {
      detach?.()
      observer?.disconnect()
    }
  }, [pathname])

  if ((unread === 0 && !panelOpen) || (dashboardScrolled && !panelOpen)) {
    return null
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setPanelOpen(!panelOpen)}
        aria-label={`Notifications (${unread} unread)`}
        aria-expanded={panelOpen}
        aria-controls={
          panelOpen ? `notification-panel-${panelTitleId}` : undefined
        }
        className={cn(
          'fixed right-16 top-[calc(var(--titlebar-h,0px)+var(--connection-banner-h,0px)+0.75rem)] flex size-11 items-center justify-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-text)] shadow-lg motion-safe:transition-transform motion-safe:hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)] md:right-4 md:top-[calc(var(--titlebar-h,0px)+0.75rem)] md:size-9',
          Z_LAYER.bell,
        )}
      >
        <HugeiconsIcon icon={Notification03Icon} size={18} strokeWidth={2} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-[var(--theme-accent)] px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {panelOpen && (
          <>
            {/* click-outside catcher, below the panel */}
            <div
              className={cn('fixed inset-0', Z_LAYER.bell)}
              onClick={() => setPanelOpen(false)}
            />
            <motion.div
              ref={panelRef}
              id={`notification-panel-${panelTitleId}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`notification-panel-title-${panelTitleId}`}
              tabIndex={-1}
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: -8, scale: 0.98 }
              }
              animate={
                reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
              }
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: -8, scale: 0.98 }
              }
              transition={{ duration: reduceMotion ? 0 : 0.15 }}
              className={cn(
                'fixed right-4 top-[calc(var(--titlebar-h,0px)+var(--connection-banner-h,0px)+3.5rem)] flex w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] shadow-2xl shadow-black/40 md:top-[calc(var(--titlebar-h,0px)+3.5rem)]',
                Z_LAYER.bell,
              )}
            >
              <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4 py-2.5">
                <p
                  id={`notification-panel-title-${panelTitleId}`}
                  className="text-sm font-semibold text-[var(--theme-text)]"
                >
                  Notifications
                </p>
                {items.length > 0 && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={markAllRead}
                      className="min-h-11 rounded px-2 text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)]"
                    >
                      Mark all read
                    </button>
                    <button
                      type="button"
                      onClick={clearAll}
                      className="min-h-11 rounded px-2 text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)]"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              <div className="max-h-[50dvh] overflow-y-auto p-1.5">
                {items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-[var(--theme-muted)]">
                    Nothing here — you're all caught up.
                  </p>
                ) : (
                  items.map((item) => <InboxItem key={item.id} item={item} />)
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
