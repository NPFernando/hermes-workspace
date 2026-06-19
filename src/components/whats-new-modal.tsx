'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { CHANGELOG, type ChangeKind, type VersionEntry } from '@/lib/changelog'

const SEEN_KEY = 'hermes-workspace-seen-version'

const KIND_STYLE: Record<ChangeKind, { label: string; className: string }> = {
  added:    { label: 'New',      className: 'bg-emerald-500/10 text-emerald-500' },
  fixed:    { label: 'Fix',      className: 'bg-rose-500/10 text-rose-400' },
  improved: { label: 'Better',   className: 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]' },
  removed:  { label: 'Removed',  className: 'bg-[var(--theme-muted)]/10 text-[var(--theme-muted)]' },
}

function ChangeList({ entry }: { entry: VersionEntry }) {
  return (
    <div className="space-y-2">
      {entry.changes.map((c, i) => {
        const style = KIND_STYLE[c.kind]
        return (
          <div key={i} className="flex items-start gap-2.5 text-sm">
            <span className={cn('mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none', style.className)}>
              {style.label}
            </span>
            <span className="text-[var(--theme-muted)] leading-snug">{c.text}</span>
          </div>
        )
      })}
    </div>
  )
}

export function WhatsNewModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const latest = CHANGELOG[0]
    const seen = localStorage.getItem(SEEN_KEY)
    if (seen !== latest.version) {
      setOpen(true)
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, CHANGELOG[0].version)
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9998] flex items-end justify-center sm:items-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-md rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] shadow-2xl shadow-black/40 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-5 py-4">
              <img src="/claude-avatar.webp" alt="Hermes" className="size-9 rounded-xl shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--theme-text)]">What's New in v{CHANGELOG[0].version}</p>
                <p className="text-xs text-[var(--theme-muted)] truncate">{CHANGELOG[0].summary}</p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                className="shrink-0 rounded-lg p-1.5 text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-hover)]"
                aria-label="Close"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
              </button>
            </div>

            {/* Scrollable change list */}
            <div className="max-h-[60dvh] overflow-y-auto px-5 py-4">
              <ChangeList entry={CHANGELOG[0]} />

              {/* Previous version teaser */}
              {CHANGELOG[1] && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-medium text-[var(--theme-muted)] hover:text-[var(--theme-text)] select-none">
                    v{CHANGELOG[1].version} — {CHANGELOG[1].summary}
                  </summary>
                  <div className="mt-3 pl-1">
                    <ChangeList entry={CHANGELOG[1]} />
                  </div>
                </details>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[var(--theme-border)] px-5 py-3">
              <span className="text-xs text-[var(--theme-muted)]">{CHANGELOG[0].date}</span>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-400"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/** Expose a trigger for manually opening from Settings */
export function useWhatsNew() {
  const [open, setOpen] = useState(false)

  const show = () => setOpen(true)
  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, CHANGELOG[0].version)
    setOpen(false)
  }

  return { open, show, dismiss }
}
