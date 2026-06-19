'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { markVersionDownloaded } from './MobilePromptTrigger'

type Platform = 'android' | 'ios' | 'desktop' | 'unknown'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent || ''
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua) || touchMac) return 'ios'
  return 'desktop'
}

interface MobileSetupModalProps {
  isOpen: boolean
  onClose: () => void
}

export function MobileSetupModal({ isOpen, onClose }: MobileSetupModalProps) {
  const [version, setVersion] = useState<{ versionCode: number; versionName: string } | null>(null)
  const [platform, setPlatform] = useState<Platform>('unknown')

  useEffect(() => {
    setPlatform(detectPlatform())
    fetch('/api/app-version')
      .then((r) => r.json() as Promise<{ versionCode: number; versionName: string }>)
      .then(setVersion)
      .catch(() => {})
  }, [])

  if (!isOpen) return null

  const handleDownload = () => {
    if (version) markVersionDownloaded(version.versionCode)
    onClose()
  }

  const isIos = platform === 'ios'
  const isAndroid = platform === 'android'
  const title = isIos ? 'Use Hermes on iPhone / iPad' : 'Get the Android App'
  const subtitle = isIos
    ? 'Install from Safari with Add to Home Screen'
    : `${version ? `v${version.versionName} · ` : ''}Native full-screen experience`

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="relative w-full max-w-sm rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-5 shadow-2xl shadow-black/40"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-hover)]"
          aria-label="Close"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2} />
        </button>

        {/* Header */}
        <div className="mb-4 flex items-center gap-3 pr-8">
          <img src="/claude-avatar.webp" alt="Hermes" className="size-10 rounded-xl" />
          <div>
            <h2 className="text-base font-semibold text-[var(--theme-text)]">{title}</h2>
            <p className="text-xs text-[var(--theme-muted)]">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Install steps */}
        <div className="mb-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3.5">
          {isIos ? (
            <ol className="space-y-1.5 text-xs text-[var(--theme-muted)] list-decimal list-inside">
              <li>Tap <span className="font-medium text-[var(--theme-text)]">Open Web App</span></li>
              <li>Use Safari&apos;s <span className="font-medium text-[var(--theme-text)]">Share</span> button</li>
              <li>Choose <span className="font-medium text-[var(--theme-text)]">Add to Home Screen</span></li>
            </ol>
          ) : (
            <ol className="space-y-1.5 text-xs text-[var(--theme-muted)] list-decimal list-inside">
              <li>Open <span className="font-medium text-[var(--theme-text)]">agent.fernandofamily.com/download-apk</span> on your Android device</li>
              <li>Tap <span className="font-medium text-[var(--theme-text)]">Download APK</span> and open the file</li>
              <li>Tap <span className="font-medium text-[var(--theme-text)]">Install</span> — allow unknown sources if prompted</li>
            </ol>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-[var(--theme-muted)] transition-colors hover:text-[var(--theme-text)]"
          >
            Dismiss
          </button>
          {isIos ? (
            <a
              href="/chat/new?source=mobile-setup-ios"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-400"
            >
              Open Web App
            </a>
          ) : (
            <a
              href="/download-apk"
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-400"
            >
              <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
                <path d="M12 16l-5-5 1.41-1.41L11 13.17V4h2v9.17l2.59-2.58L17 11zM5 20h14v-2H5z" />
              </svg>
              {isAndroid ? 'Open Download Page' : 'Send to Android'}
            </a>
          )}
        </div>
      </motion.div>
    </div>
  )
}
