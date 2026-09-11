/**
 * MobilePageHeader — native app-style sticky top bar for non-chat pages.
 * Shows hamburger on the left, page title centered, optional right action.
 */
import type { ReactNode } from 'react'
import { openHamburgerMenu } from '@/components/mobile-hamburger-menu'
import { cn } from '@/lib/utils'

type MobilePageHeaderProps = {
  title: string
  right?: ReactNode
  className?: string
}

export function MobilePageHeader({
  title,
  right,
  className,
}: MobilePageHeaderProps) {
  return (
    <div
      className={cn(
        'md:hidden flex items-center h-12 px-2 shrink-0',
        'border-b bg-[var(--theme-panel)]/95 backdrop-blur-md',
        className,
      )}
      style={{
        borderColor: 'var(--theme-border)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <button
        type="button"
        aria-label="Open navigation menu"
        onClick={openHamburgerMenu}
        className="z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--theme-text)] transition-colors active:bg-[var(--theme-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-panel)] touch-manipulation"
      >
        <svg
          width="20"
          height="16"
          viewBox="0 0 20 16"
          fill="none"
          className="opacity-70 text-[var(--theme-text)]"
        >
          <path
            d="M1 1.5H19M1 8H19M1 14.5H13"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span className="flex-1 text-center text-[15px] font-semibold truncate -ml-11 text-[var(--theme-text)]">
        {title}
      </span>
      <div className="shrink-0 w-9">{right ?? null}</div>
    </div>
  )
}
