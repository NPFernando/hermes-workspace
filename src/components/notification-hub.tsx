'use client'


import { Suspense, lazy, useEffect, useState } from 'react'
const UpdateCenterNotifier = lazy(() =>
  import('./update-center-notifier').then((m) => ({
    default: m.UpdateCenterNotifier,
  })),
)
import { hasUnseenUpdates, WhatsNewModal } from './whats-new-modal'
import { MobilePromptTrigger } from './mobile-prompt/MobilePromptTrigger'

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

/**
 * Central popup coordinator.
 *
 * Priority order (one at a time):
 *   1. UpdateCenterNotifier — always mounted; manages own toast/panel visibility
 *   2. WhatsNewModal — shown after INITIAL_DELAY_MS if unseen
 *   3. MobilePromptTrigger — mounted only on mobile/PWA; manages own timing
 *
 * Nothing shows during the first INITIAL_DELAY_MS. After WhatsNew is dismissed
 * there is a BETWEEN_GAP_MS gap before MobilePrompt is allowed to mount.
 */
export function NotificationHub() {
  const [ready, setReady] = useState(false)
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [whatsNewDone, setWhatsNewDone] = useState(false)

  // Capture mobile/PWA at mount time (stable across re-renders)
  const [isMobile] = useState(isMobileOrPWAContext)

  // Phase 1: initial page-load delay before any popup
  useEffect(() => {
    const t = setTimeout(() => setReady(true), INITIAL_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  // Phase 2: once ready, decide first popup
  useEffect(() => {
    if (!ready) return
    if (hasUnseenUpdates()) {
      setShowWhatsNew(true)
    } else {
      setWhatsNewDone(true)
    }
  }, [ready])

  const handleWhatsNewDismissed = () => {
    setShowWhatsNew(false)
    // Brief gap before next popup is allowed to mount
    setTimeout(() => setWhatsNewDone(true), BETWEEN_GAP_MS)
  }

  return (
    <>
      {/* UpdateCenterNotifier is always present — it self-manages visibility */}
      <Suspense fallback={null}>
        <UpdateCenterNotifier />
      </Suspense>

      {/* WhatsNewModal: mount only when the hub decides it should show */}
      {showWhatsNew && <WhatsNewModal onDismissed={handleWhatsNewDismissed} />}

      {/*
        MobilePromptTrigger: mount only on mobile/PWA, and only after WhatsNew
        is resolved. Once mounted it self-manages its own delay and visibility.
        On desktop this never mounts — suppressing the 45-second install nag.
      */}
      {whatsNewDone && isMobile && <MobilePromptTrigger />}
    </>
  )
}
