import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import type {
  DashboardIncident,
  DashboardOverview,
} from '@/server/dashboard-aggregator'

const SEVERITY_COLOR: Record<DashboardIncident['severity'], string> = {
  warn: 'var(--theme-warning)',
  error: 'var(--theme-danger)',
  info: 'var(--theme-muted)',
}

/**
 * Compact attention rail that surfaces the same `incidents[]` payload
 * the previous dashboard attention panel used to render. Lives inside `OpsStrip`
 * so attention items occupy the same horizontal "10-second status
 * read" line operators already glance at.
 *
 * Behavior:
 * - Hidden when there are no incidents (no empty marquee row).
 * - Keeps the list statically readable instead of moving alert text under
 *   the operator's cursor or screenshot at an arbitrary point.
 * - Allows horizontal scrolling when several long incidents are present.
 * - Each item is a link that routes to the most context-appropriate
 *   page (cron → /jobs, config → /settings, log/gateway → /logs).
 */
export function AttentionMarquee({
  overview,
}: {
  overview: DashboardOverview | null
}) {
  const navigate = useNavigate()
  const items = overview?.incidents ?? []
  const itemsRef = useRef<HTMLDivElement>(null)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateOverflow = useCallback(() => {
    const element = itemsRef.current
    setCanScrollRight(
      Boolean(element && element.scrollWidth - element.clientWidth > 2),
    )
  }, [])

  useEffect(() => {
    const element = itemsRef.current
    if (!element) return
    updateOverflow()
    element.addEventListener('scroll', updateOverflow, { passive: true })
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', updateOverflow)
      observer.disconnect()
    }
  }, [items.length, updateOverflow])

  if (items.length === 0) return null

  return (
    <div
      role="region"
      className="group relative flex flex-col items-stretch gap-1.5 overflow-hidden rounded-md border px-2 py-1.5 sm:flex-row sm:items-center sm:gap-2 sm:py-1"
      style={{
        background:
          'linear-gradient(90deg, color-mix(in srgb, var(--theme-warning) 10%, transparent), transparent 70%)',
        borderColor:
          'color-mix(in srgb, var(--theme-warning) 35%, transparent)',
      }}
      title={`${items.length} item${items.length === 1 ? '' : 's'} need attention`}
      aria-label={`${items.length} workspace attention item${items.length === 1 ? '' : 's'}`}
    >
      <span
        className="z-10 shrink-0 self-start rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] sm:self-auto"
        style={{
          background:
            'color-mix(in srgb, var(--theme-warning) 18%, transparent)',
          color: 'var(--theme-warning)',
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <HugeiconsIcon icon={Alert01Icon} size={12} strokeWidth={1.8} />
          Attention · {items.length}
        </span>
      </span>

      <div
        ref={itemsRef}
        role="group"
        aria-label={
          canScrollRight
            ? 'Scrollable workspace attention items. Use horizontal scrolling to view all alerts.'
            : 'Workspace attention items'
        }
        tabIndex={0}
        onScroll={updateOverflow}
        className="min-h-5 min-w-0 flex-1 touch-pan-x overflow-x-auto overscroll-x-contain whitespace-nowrap [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)]"
      >
        <div className="flex min-w-max items-center gap-5 pl-3">
          {items.map((item) => {
            const href =
              item.href ||
              (item.source === 'cron'
                ? '/jobs'
                : item.source === 'config'
                  ? '/settings'
                  : '/jobs')
            const isExternal = /^https?:\/\//i.test(href)
            return (
              <a
                key={item.id}
                href={href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                onClick={(event) => {
                  if (
                    isExternal ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return
                  }
                  try {
                    const internalUrl = new URL(href, window.location.origin)
                    if (internalUrl.origin !== window.location.origin) return
                    event.preventDefault()
                    void navigate({
                      to: `${internalUrl.pathname}${internalUrl.search}${internalUrl.hash}` as never,
                    } as never)
                  } catch {
                    // Leave malformed or unsupported hrefs to the browser.
                  }
                }}
                className="inline-flex min-h-11 max-w-[min(72vw,36rem)] items-center gap-1.5 truncate rounded-sm font-mono text-[10px] uppercase tracking-[0.1em] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset lg:min-h-0"
                style={{ color: SEVERITY_COLOR[item.severity] }}
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: SEVERITY_COLOR[item.severity] }}
                />
                <span className="truncate text-[var(--theme-text)]">
                  {item.label}
                </span>
                {item.detail ? (
                  <span className="truncate text-[var(--theme-muted)]">
                    · {item.detail}
                  </span>
                ) : null}
              </a>
            )
          })}
        </div>
      </div>
      {canScrollRight ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-end bg-gradient-to-l from-[var(--theme-card)] via-[var(--theme-card)]/90 to-transparent pr-1 text-sm text-[var(--theme-warning)] opacity-90"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.8} />
        </span>
      ) : null}
    </div>
  )
}
