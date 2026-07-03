'use client'


import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hasUnseenUpdates } from './whats-new-modal'
import { UpdateDigestModal } from './update-digest-modal'
import { MobilePromptTrigger } from './mobile-prompt/MobilePromptTrigger'
import type { ReleaseNoteSection, ReleaseNotes } from '@/lib/update-notes'
import { storeNotes } from '@/lib/update-notes'

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

const INITIAL_DELAY_MS = 4_000
const BETWEEN_GAP_MS = 1_500
/** Give the update-status poll this long past the initial delay before
 * showing the digest without agent notes (offline/slow gateway). */
const STATUS_WAIT_TIMEOUT_MS = 15_000
/** Must match UpdateCenterNotifier so the shared query cache stays coherent */
const CHECK_INTERVAL_MS = 30 * 60 * 1000

type Digest = {
  agentNotes: ReleaseNotes | null
  showWorkspace: boolean
}

/**
 * Central popup coordinator.
 *
 * Priority order (one at a time):
 *   1. UpdateCenterNotifier — always mounted; owns the "update available"
 *      cards and post-apply release notes, but NOT the startup changelog
 *      popups (those are lifted into the hub, see below)
 *   2. UpdateDigestModal — ONE combined "what changed" popup covering both
 *      unseen agent release notes and the unseen workspace changelog
 *   3. MobilePromptTrigger — mounted only on mobile/PWA; manages own timing
 *
 * Nothing shows during the first INITIAL_DELAY_MS. After the digest is
 * dismissed there is a BETWEEN_GAP_MS gap before MobilePrompt may mount.
 */
export function NotificationHub() {
  const [ready, setReady] = useState(false)
  const [digest, setDigest] = useState<Digest | null>(null)
  const [digestDone, setDigestDone] = useState(false)
  const decided = useRef(false)

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

  // Phase 1: initial page-load delay before any popup
  useEffect(() => {
    const t = setTimeout(() => setReady(true), INITIAL_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  // Phase 2: once ready and the update status has settled, decide the one
  // digest popup covering everything unseen. Decide exactly once per load.
  useEffect(() => {
    if (!ready || decided.current) return

    const decide = (sections?: Array<ReleaseNoteSection>) => {
      if (decided.current) return
      decided.current = true
      // storeNotes persists the payload and returns null when already seen
      const agentNotes = sections?.length ? storeNotes(sections) : null
      const showWorkspace = hasUnseenUpdates()
      if (agentNotes || showWorkspace) {
        setDigest({ agentNotes, showWorkspace })
      } else {
        setDigestDone(true)
      }
    }

    if (isFetched) {
      decide(updateStatus?.pendingReleaseNotes)
      return
    }
    // Don't hold the workspace changelog hostage to a hanging status request
    const t = setTimeout(() => decide(), STATUS_WAIT_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [ready, isFetched, updateStatus])

  const handleDigestDismissed = () => {
    setDigest(null)
    // Brief gap before next popup is allowed to mount
    setTimeout(() => setDigestDone(true), BETWEEN_GAP_MS)
  }

  return (
    <>
      {/* UpdateCenterNotifier is always present — it self-manages the
          "update available" cards; changelog popups are handled below */}
      <Suspense fallback={null}>
        <UpdateCenterNotifier />
      </Suspense>

      {/* One combined update digest: mount only when the hub decides */}
      {digest && (
        <UpdateDigestModal
          agentNotes={digest.agentNotes}
          showWorkspace={digest.showWorkspace}
          onDismissed={handleDigestDismissed}
        />
      )}

      {/*
        MobilePromptTrigger: mount only on mobile/PWA, and only after the
        digest is resolved. Once mounted it self-manages its own delay and
        visibility. On desktop this never mounts — suppressing the
        45-second install nag.
      */}
      {digestDone && isMobile && <MobilePromptTrigger />}
    </>
  )
}
