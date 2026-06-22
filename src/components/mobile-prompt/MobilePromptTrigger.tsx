'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { MobileSetupModal } from './MobileSetupModal'

const ANDROID_PACKAGE = 'com.fernandofamily.hermes'
const LOCAL_VERSION_KEY = 'hermes-apk-downloaded-version'
const SESSION_DISMISSED_KEY = 'hermes-mobile-prompt-dismissed'

type AppVersion = { versionCode: number; versionName: string }
type PromptState = 'hidden' | 'install' | 'update'

function isRunningAsApp(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone
  )
}

async function isAndroidAppInstalled(): Promise<boolean> {
  if (!('getInstalledRelatedApps' in navigator)) return false
  try {
    const apps = await (
      navigator as Navigator & {
        getInstalledRelatedApps: () => Promise<Array<{ id?: string }>>
      }
    ).getInstalledRelatedApps()
    return apps.some((a) => a.id === ANDROID_PACKAGE)
  } catch {
    return false
  }
}

async function fetchLatestVersion(): Promise<AppVersion | null> {
  try {
    const res = await fetch('/api/app-version')
    if (!res.ok) return null
    return res.json() as Promise<AppVersion>
  } catch {
    return null
  }
}

function getDownloadedVersion(): number {
  try {
    return parseInt(localStorage.getItem(LOCAL_VERSION_KEY) ?? '0', 10) || 0
  } catch {
    return 0
  }
}

export function markVersionDownloaded(versionCode: number) {
  try {
    localStorage.setItem(LOCAL_VERSION_KEY, String(versionCode))
  } catch {}
}

export function MobilePromptTrigger() {
  const [promptState, setPromptState] = useState<PromptState>('hidden')
  const [latestVersion, setLatestVersion] = useState<AppVersion | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const inApp = useRef(false)

  useEffect(() => {
    inApp.current = isRunningAsApp()

    // Force-open via URL param (dev preview)
    if (new URLSearchParams(window.location.search).get('mobile-preview') === '1') {
      const url = new URL(window.location.href)
      url.searchParams.delete('mobile-preview')
      window.history.replaceState({}, '', url.toString())
      setIsModalOpen(true)
      return
    }

    // Permanent opt-out
    if (localStorage.getItem('claude-mobile-access-dismissed') === 'true') return

    async function evaluate() {
      const [version, installed] = await Promise.all([
        fetchLatestVersion(),
        isAndroidAppInstalled(),
      ])

      setLatestVersion(version)
      const downloadedCode = getDownloadedVersion()
      const latestCode = version?.versionCode ?? 0

      // Inside the TWA: only show if there's a newer version to download
      if (inApp.current) {
        if (latestCode > downloadedCode) {
          setPromptState('update')
        }
        return
      }

      // In browser: don't show if user dismissed this session
      if (sessionStorage.getItem(SESSION_DISMISSED_KEY) === 'true') return

      if (installed && latestCode > downloadedCode) {
        // App is installed but outdated
        setPromptState('update')
        return
      }

      if (!installed) {
        // App not installed — show after delay (10 s mobile, 45 s desktop)
        const delay = window.innerWidth <= 768 ? 10_000 : 45_000
        const timer = window.setTimeout(() => {
          if (sessionStorage.getItem(SESSION_DISMISSED_KEY) === 'true') return
          setPromptState('install')
        }, delay)
        return () => window.clearTimeout(timer)
      }
    }

    let cleanup: (() => void) | undefined
    evaluate().then((fn) => { cleanup = fn })
    return () => cleanup?.()
  }, [])

  const dismiss = () => {
    if (dontShowAgain) localStorage.setItem('claude-mobile-access-dismissed', 'true')
    sessionStorage.setItem(SESSION_DISMISSED_KEY, 'true')
    setPromptState('hidden')
  }

  const openSetup = () => {
    sessionStorage.setItem(SESSION_DISMISSED_KEY, 'true')
    setPromptState('hidden')
    setIsModalOpen(true)
  }

  const goToDownload = () => {
    if (latestVersion) markVersionDownloaded(latestVersion.versionCode)
    window.location.href = '/download-apk'
  }

  const isUpdate = promptState === 'update'
  const visible = promptState !== 'hidden'

  return (
    <>
      <AnimatePresence>
        {visible ? (
          <motion.div
            key={promptState}
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.95 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="fixed left-1/2 z-[9999] w-[90vw] max-w-md -translate-x-1/2 overflow-hidden rounded-2xl shadow-2xl top-[calc(var(--titlebar-h,0px)+1rem)] bg-[var(--theme-card)] border border-[var(--theme-border)] text-[var(--theme-text)]"
            style={{ boxShadow: 'var(--theme-shadow-3)' }}
          >
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <img
                  src="/claude-avatar.webp"
                  alt="Hermes"
                  className="size-8 shrink-0 rounded-lg"
                />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--theme-text)]">
                    {isUpdate
                      ? `Update available — v${latestVersion?.versionName ?? ''}`
                      : 'Get the Android app'}
                  </p>
                  <p className="text-xs text-[var(--theme-muted)]">
                    {isUpdate
                      ? 'A new version of the Hermes app is ready to install.'
                      : 'Install Hermes for a native full-screen experience.'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={isUpdate ? goToDownload : openSetup}
                    className="rounded-lg px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-white bg-[var(--theme-accent)] touch-manipulation"
                  >
                    {isUpdate ? 'Update' : 'Set up'}
                  </button>
                  {/* Updates inside the app always dismissible; install prompt has dismiss too */}
                  <button
                    type="button"
                    onClick={dismiss}
                    className="rounded-lg p-2.5 sm:p-1.5 touch-manipulation transition-colors hover:opacity-80 text-[var(--theme-muted)]"
                    aria-label="Dismiss"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
                  </button>
                </div>
              </div>

              {!inApp.current && (
                <label className="mt-3 flex items-center gap-2 text-xs text-[var(--theme-muted)]">
                  <input
                    type="checkbox"
                    checked={dontShowAgain}
                    onChange={(e) => setDontShowAgain(e.target.checked)}
                    className="size-3.5 rounded border border-[var(--theme-border)] bg-[var(--theme-card2)]"
                  />
                  <span>Don&apos;t show this again</span>
                </label>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <MobileSetupModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  )
}
