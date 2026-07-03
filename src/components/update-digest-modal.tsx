'use client'

import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import { ChangeList, markWhatsNewSeen } from './whats-new-modal'
import type { ReleaseNotes } from '@/lib/update-notes'

import { CHANGELOG } from '@/lib/changelog'
import { markNotesSeen, shortSha } from '@/lib/update-notes'

type UpdateDigestModalProps = {
  /** Unseen Hermes Agent / product release notes (commit lists), if any */
  agentNotes: ReleaseNotes | null
  /** True when the workspace changelog for the current version is unseen */
  showWorkspace: boolean
  onDismissed?: () => void
}

/**
 * Single combined "what changed" popup.
 *
 * Replaces the previous pair of independent popups (UpdateCenterNotifier's
 * "Hermes updated" release notes + WhatsNewModal's workspace changelog) with
 * one modal that renders whichever sections are unseen. NotificationHub
 * decides when to mount it; dismissing marks every included source as seen.
 */
export function UpdateDigestModal({
  agentNotes,
  showWorkspace,
  onDismissed,
}: UpdateDigestModalProps) {
  const [open, setOpen] = useState(true)

  const workspaceEntry = showWorkspace ? CHANGELOG[0] : null
  const sources = [
    ...(agentNotes ? ['Hermes Agent'] : []),
    ...(workspaceEntry ? [`Workspace v${workspaceEntry.version}`] : []),
  ]

  const dismiss = () => {
    if (agentNotes) markNotesSeen(agentNotes)
    if (workspaceEntry) markWhatsNewSeen()
    setOpen(false)
    // Delay callback until after exit animation (~250ms)
    if (onDismissed) setTimeout(onDismissed, 350)
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
            className="relative w-full max-w-lg rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] shadow-2xl shadow-black/40 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-5 py-4">
              <img src="/claude-avatar.webp" alt="Hermes" className="size-9 rounded-xl shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--theme-text)]">
                  {sources.length > 1 ? 'Hermes updated' : `What's New — ${sources[0]}`}
                </p>
                <p className="text-xs text-[var(--theme-muted)] truncate">
                  {sources.length > 1
                    ? `What changed in ${sources.join(' and ')}`
                    : agentNotes
                      ? 'What changed in this update.'
                      : workspaceEntry?.summary}
                </p>
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

            {/* Scrollable sections */}
            <div className="max-h-[60dvh] space-y-5 overflow-y-auto px-5 py-4">
              {agentNotes?.sections.map((section) => (
                <section key={`${section.product}:${section.to}`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[var(--theme-text)]">{section.label}</h3>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] bg-[var(--theme-card2)] text-[var(--theme-muted)]">
                      {shortSha(section.from)} → {shortSha(section.to)}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {(section.commits.length
                      ? section.commits
                      : ['Updated to the latest available version.']
                    ).map((commit, index) => (
                      <li
                        key={`${section.product}-${index}-${commit}`}
                        className="rounded-xl px-3 py-2 text-sm bg-[var(--theme-card2)] text-[var(--theme-text)]"
                      >
                        {commit}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {workspaceEntry && (
                <section>
                  {agentNotes && (
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="shrink-0 whitespace-nowrap text-sm font-semibold text-[var(--theme-text)]">
                        Workspace v{workspaceEntry.version}
                      </h3>
                      <span className="min-w-0 truncate text-[11px] text-[var(--theme-muted)]">
                        {workspaceEntry.summary}
                      </span>
                    </div>
                  )}
                  <ChangeList entry={workspaceEntry} />

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
                </section>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[var(--theme-border)] px-5 py-3">
              <span className="text-xs text-[var(--theme-muted)]">
                {workspaceEntry?.date ?? ''}
              </span>
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
