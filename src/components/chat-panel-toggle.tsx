/**
 * Floating button to toggle the chat panel on non-chat routes.
 * Shows in bottom-right corner. Hidden when chat panel is open.
 */
import { HugeiconsIcon } from '@hugeicons/react'
import { Chat01Icon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Button } from '@/components/ui/button'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function ChatPanelToggle() {
  const isOpen = useWorkspaceStore((s) => s.chatPanelOpen)
  const toggleChatPanel = useWorkspaceStore((s) => s.toggleChatPanel)
  const reduceMotion = useReducedMotion()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [dashboardScrolled, setDashboardScrolled] = useState(false)

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

  const hideOnDashboardTop = pathname === '/dashboard' && !dashboardScrolled

  if (hideOnDashboardTop) return null

  return (
    <AnimatePresence>
      {!isOpen && (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}
          className="fixed bottom-[calc(var(--metrics-footer-h,0px)+0.75rem)] right-4 z-50"
        >
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                onClick={toggleChatPanel}
                render={
                  <Button
                    size="icon"
                    className="size-11 rounded-full bg-accent-500 text-white shadow-lg ring-4 ring-[var(--theme-bg)]/90 motion-safe:transition-all motion-safe:hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)]"
                    aria-label="Open chat"
                  >
                    <HugeiconsIcon
                      icon={Chat01Icon}
                      size={22}
                      strokeWidth={1.5}
                    />
                  </Button>
                }
              />
              <TooltipContent side="left">
                <span>
                  Chat <kbd className="ml-1 text-[10px] opacity-60">⌘J</kbd>
                </span>
              </TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
