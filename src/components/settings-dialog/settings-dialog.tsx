'use client'

import {
  ArrowLeft01Icon,
  Cancel01Icon,
  CloudIcon,
  MessageMultiple01Icon,
  Notification03Icon,
  PaintBoardIcon,
  Settings02Icon,
  VolumeHighIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Component, useEffect, useState } from 'react'
import { HermesContent } from './sections/hermes-content'
import { AppearanceContent } from './sections/appearance-content'
import { ChatContent } from './sections/chat-content'
import { NotificationsContent } from './sections/notifications-content'
import { AgentBehaviorContent } from './sections/agent-behavior-content'
import { VoiceContent } from './sections/voice-content'
import { DisplayContent } from './sections/display-content'
import { LanguageContent } from './sections/language-content'
import type { ThemeId } from '@/lib/theme'
import type * as React from 'react'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type SectionId =
  | 'claude'
  | 'agent'
  | 'voice'
  | 'display'
  | 'appearance'
  | 'chat'
  | 'notifications'
  | 'language'

const SECTIONS: Array<{ id: SectionId; label: string; icon: any }> = [
  { id: 'claude', label: 'Model & Provider', icon: CloudIcon },
  { id: 'agent', label: 'Agent', icon: Settings02Icon },
  { id: 'voice', label: 'Voice', icon: VolumeHighIcon },
  { id: 'display', label: 'Display', icon: PaintBoardIcon },
  { id: 'appearance', label: 'Theme', icon: PaintBoardIcon },
  { id: 'chat', label: 'Chat', icon: MessageMultiple01Icon },
  { id: 'notifications', label: 'Alerts', icon: Notification03Icon },
  { id: 'language', label: 'Language', icon: MessageMultiple01Icon },
]

const DARK_ENTERPRISE_THEMES = new Set<ThemeId>([
  'claude-nous',
  'claude-official',
  'claude-classic',
  'claude-slate',
])

function _isDarkEnterpriseTheme(theme: string | null): theme is ThemeId {
  if (!theme) return false
  return DARK_ENTERPRISE_THEMES.has(theme as ThemeId)
}
void _isDarkEnterpriseTheme


class SettingsErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div>
            <p className="mb-2 text-sm font-medium text-red-500">
              Settings failed to load
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-xs text-[var(--theme-muted)] underline hover:text-[var(--theme-text)]"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const CONTENT_MAP: Record<SectionId, () => React.JSX.Element> = {
  claude: HermesContent,
  agent: AgentBehaviorContent,
  voice: VoiceContent,
  display: DisplayContent,
  appearance: AppearanceContent,
  chat: ChatContent,
  notifications: NotificationsContent,
  language: LanguageContent,
}

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSection?: SectionId
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection = 'claude',
}: SettingsDialogProps) {
  const [active, setActive] = useState<SectionId>(initialSection)
  const [mobileView, setMobileView] = useState<'nav' | 'content'>('nav')
  const ActiveContent = CONTENT_MAP[active]

  useEffect(() => {
    if (open) {
      setActive(initialSection)
      setMobileView('nav')
    }
  }, [initialSection, open])

  function handleSectionSelect(sectionId: SectionId) {
    setActive(sectionId)
    setMobileView('content')
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 h-full w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(88dvh,740px)] md:min-h-[520px] md:w-full md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:border-[var(--theme-border)] bg-[var(--theme-bg)]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-4 md:rounded-t-2xl md:px-5">
            <div>
              <DialogTitle className="text-base font-semibold text-[var(--theme-text)]">
                Settings
              </DialogTitle>
              <DialogDescription className="sr-only">
                Configure Hermes Workspace
              </DialogDescription>
            </div>
            <DialogClose
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="rounded-full text-[var(--theme-muted)] hover:bg-[var(--theme-card)]"
                  aria-label="Close"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={18}
                    strokeWidth={1.5}
                  />
                </Button>
              }
            />
          </div>

          <SettingsErrorBoundary>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <aside
                className={cn(
                  'w-full bg-[var(--theme-panel)] p-2 md:w-44 md:shrink-0 md:border-r md:border-[var(--theme-border)]',
                  mobileView === 'content' && 'hidden md:block',
                )}
              >
                <nav className="space-y-1">
                  {SECTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSectionSelect(s.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-hover)]',
                        active === s.id &&
                          'bg-accent-50 font-medium text-accent-700',
                      )}
                    >
                      <HugeiconsIcon
                        icon={s.icon}
                        size={16}
                        strokeWidth={1.5}
                      />
                      {s.label}
                    </button>
                  ))}
                </nav>
              </aside>
              <div
                className={cn(
                  'min-w-0 flex-1 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:p-5 md:pb-5',
                  mobileView === 'nav' && 'hidden md:block',
                )}
              >
                <div className="mb-3 md:hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMobileView('nav')}
                    className="h-8 gap-1.5 rounded-lg px-2 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]"
                  >
                    <HugeiconsIcon
                      icon={ArrowLeft01Icon}
                      size={16}
                      strokeWidth={1.5}
                    />
                    Back
                  </Button>
                </div>
                <ActiveContent />
              </div>
            </div>
          </SettingsErrorBoundary>

          <div className="sticky bottom-0 z-10 border-t border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-3 text-xs text-[var(--theme-muted)] md:rounded-b-2xl md:px-5">
            Most changes save automatically; the default model commits only when you click Set as default.{' '}
            <a
              href="/settings"
              className="ml-2 font-medium underline underline-offset-2 hover:text-[var(--theme-muted)] dark:hover:text-neutral-200"
            >
              All settings →
            </a>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
