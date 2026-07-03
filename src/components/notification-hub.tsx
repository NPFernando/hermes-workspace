'use client'

import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { MobilePromptTrigger } from './mobile-prompt/MobilePromptTrigger'
import { NotificationBell } from './notification-bell'
import { UpdateDigestModal } from './update-digest-modal'
import { hasUnseenUpdates } from './whats-new-modal'
import type { ReleaseNoteSection, ReleaseNotes } from '@/lib/update-notes'

import { toast } from '@/components/ui/toast'
import { readStoredNotes, storeNotes } from '@/lib/update-notes'
import { useNotificationCenterStore } from '@/stores/notification-center-store'
import { usePopupSlot } from '@/stores/popup-queue-store'
import { CHANGELOG } from '@/lib/changelog'

const UpdateCenterNotifier = lazy(() =>
  import('./update-center-notifier').then((m) => ({
    default: m.UpdateCenterNotifier,
  })),
)

/** True when running as a PWA / Android TWA, or on a narrow mobile viewport */
function isMobileOrPWAContext(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone ||
    window.innerWidth <= 900
  )
}

/** Give the update-status poll this long before deciding without agent
 * notes (offline/slow gateway must not block the workspace changelog). */
const STATUS_WAIT_TIMEOUT_MS = 15_000
/** Must match UpdateCenterNotifier so the shared query cache stays coherent */
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const MOBILE_PROMPT_GAP_MS = 1_500

type Digest = {
  agentNotes: ReleaseNotes | null
  showWorkspace: boolean
}

/**
 * Central notification coordinator.
 *
 * On page load it publishes unseen "what changed" content (agent release
 * notes + workspace changelog) into the notification inbox instead of
 * popping modals. The bell shows an unread badge; a small toast offers a
 * one-click "See what's new". The old auto-popup behavior is available
 * behind the `autoPopupDigest` preference and then goes through the
 * central popup queue (startup quiet period, one modal at a time,
 * deferred while chat is streaming).
 */
export function NotificationHub() {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [digestDismissed, setDigestDismissed] = useState(false)
  const [mobileAllowed, setMobileAllowed] = useState(false)
  const decided = useRef(false)

  const publish = useNotificationCenterStore((s) => s.publish)
  const markRead = useNotificationCenterStore((s) => s.markRead)
  const digestOpen = useNotificationCenterStore((s) => s.digestOpen)
  const closeDigest = useNotificationCenterStore((s) => s.closeDigest)
  const openDigest = useNotificationCenterStore((s) => s.openDigest)

  // Capture mobile/PWA at mount time (stable across re-renders)
  const [isMobile] = useState(isMobileOrPWAContext)

  // Same queryKey as UpdateCenterNotifier — shared cache, single fetch
  const { data: updateStatus, isFetched } = useQuery({
    queryKey: ['update-status-v2'],
    queryFn: async () => {
      const res = await fetch('/api/update/status')
      if (!res.ok) return null
      return res.json() as Promise<{
        pendingReleaseNotes?: Array<ReleaseNoteSection>
      }>
    },
    refetchInterval: CHECK_INTERVAL_MS,
    staleTime: CHECK_INTERVAL_MS,
    retry: false,
  })

  // Decide once per page load what is unseen, then publish to the inbox.
  useEffect(() => {
    if (decided.current) return

    const decide = (sections?: Array<ReleaseNoteSection>) => {
      if (decided.current) return
      decided.current = true

      // storeNotes persists the payload and returns null when already seen
      const agentNotes = sections?.length ? storeNotes(sections) : null
      const showWorkspace = hasUnseenUpdates()

      let inserted = false
      if (agentNotes) {
        inserted =
          publish({
            id: `agent-notes:${agentNotes.id}`,
            category: 'updates',
            title: 'Hermes Agent updated',
            body: agentNotes.sections
              .flatMap((section) => section.commits)
              .slice(0, 2)
              .join(' · '),
            action: 'open-update-digest',
          }) || inserted
      }
      if (showWorkspace) {
        inserted =
          publish({
            id: `workspace-changelog:${CHANGELOG[0].version}`,
            category: 'changelog',
            title: `Workspace v${CHANGELOG[0].version} — what's new`,
            body: CHANGELOG[0].summary,
            action: 'open-update-digest',
          }) || inserted
      }

      if (agentNotes || showWorkspace) {
        if (useNotificationCenterStore.getState().prefs.autoPopupDigest) {
          setDigest({ agentNotes, showWorkspace })
          return
        }
        if (
          inserted &&
          useNotificationCenterStore.getState().prefs.toastOnNewItems
        ) {
          toast('Updates available', {
            type: 'info',
            icon: '✨',
            duration: 8000,
            action: { label: "See what's new", onClick: openDigest },
          })
        }
      }
      setMobileAllowed(true)
    }

    if (isFetched) {
      decide(updateStatus?.pendingReleaseNotes)
      return
    }
    // Don't hold the changelog hostage to a hanging status request
    const t = setTimeout(() => decide(), STATUS_WAIT_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [isFetched, updateStatus, publish, openDigest])

  // Auto-popup path (autoPopupDigest pref): goes through the popup queue
  const wantAutoDigest = digest !== null && !digestDismissed
  const autoDigestActive = usePopupSlot(
    'modal',
    'update-digest',
    100,
    wantAutoDigest,
  )

  const markDigestItemsRead = () => {
    const stored = readStoredNotes()
    if (stored) markRead(`agent-notes:${stored.id}`)
    markRead(`workspace-changelog:${CHANGELOG[0].version}`)
  }

  const handleAutoDigestDismissed = () => {
    markDigestItemsRead()
    setDigestDismissed(true) // releases the popup slot via wanted=false
    setTimeout(() => setMobileAllowed(true), MOBILE_PROMPT_GAP_MS)
  }

  const handleManualDigestDismissed = () => {
    markDigestItemsRead()
    closeDigest()
  }

  return (
    <>
      {/* Update-available cards + post-apply notes; self-managed */}
      <Suspense fallback={null}>
        <UpdateCenterNotifier />
      </Suspense>

      {/* Floating bell + inbox panel (renders nothing when all read) */}
      <NotificationBell />

      {/* Legacy auto-popup digest, gated by the central popup queue */}
      {autoDigestActive && digest && (
        <UpdateDigestModal
          agentNotes={digest.agentNotes}
          showWorkspace={digest.showWorkspace}
          onDismissed={handleAutoDigestDismissed}
        />
      )}

      {/* Digest opened from the inbox or the "See what's new" toast */}
      {digestOpen && (
        <UpdateDigestModal
          agentNotes={readStoredNotes()}
          showWorkspace
          onDismissed={handleManualDigestDismissed}
        />
      )}

      {/*
        MobilePromptTrigger: mount only on mobile/PWA, and only after the
        startup decision (and any auto digest) has resolved. Once mounted
        it self-manages its own delay and visibility. On desktop this
        never mounts — suppressing the 45-second install nag.
      */}
      {mobileAllowed && isMobile && <MobilePromptTrigger />}
    </>
  )
}
