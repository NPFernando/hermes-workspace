import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type SisterOption = {
  id: string
  name: string
  emoji: string
  description: string
  systemPrompt?: string
}

type SisterPickerProps = {
  sisters: Array<SisterOption>
  selectedId: string | null
  autoSelectedId?: string | null
  orchestrating?: boolean
  orchestratingSisterIds?: Array<string>
  onSelect: (id: string | null) => void
}

export function SisterPicker({
  sisters,
  selectedId,
  autoSelectedId,
  orchestrating,
  orchestratingSisterIds,
  onSelect,
}: SisterPickerProps) {
  const hasOverride = Boolean(selectedId || autoSelectedId)

  // Determine the current sister to display in the chip
  let currentSister: SisterOption | null = null
  if (selectedId) {
    currentSister = sisters.find((s) => s.id === selectedId) ?? null
  } else if (autoSelectedId) {
    currentSister = sisters.find((s) => s.id === autoSelectedId) ?? null
  }

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setAnchorEl(triggerRef.current)
    }
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  useEffect(() => {
    if (anchorEl) {
      const handleClickOutside = (event: MouseEvent) => {
        if (!anchorEl.contains(event.target as Node)) {
          setAnchorEl(null)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [anchorEl])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  if (sisters.length === 0) return null

  return (
    <div className="flex items-center gap-1 px-2 py-1 flex-wrap">
      <span className="text-xs text-muted-foreground mr-1 shrink-0">Agent:</span>
      {orchestrating && !orchestratingSisterIds?.length && (
        <span className="text-xs text-muted-foreground animate-pulse mr-1">🌟 Astra orchestrating…</span>
      )}
      <div className="relative">
        {/* Anchor for the popover */}
        <div
          ref={triggerRef}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="button"
          className={cn(
            'flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-hover)]/50 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]/100 transition-colors',
            !currentSister && 'text-xs',
          )}
        >
          {currentSister ? (
            <>
              <span className="text-xs">{currentSister.emoji}</span>
              <span className="ml-1 text-xs">{currentSister.name}</span>
              {orchestrating && orchestratingSisterIds?.includes(currentSister.id) && (
                <span className="ml-0.5 text-[9px] opacity-60">✦</span>
              )}
            </>
          ) : (
            <span className="text-xs">Auto</span>
          )}
        </div>

        {/* Popover menu */}
        {anchorEl && (
          <div
            className="absolute left-0 top-full mt-1 w-56 border border-[var(--theme-border)] bg-[var(--theme-card)] z-50 shadow-xl rounded-md p-1 space-y-1"
            role="menu"
          >
            {sisters.map((sister) => {
              const isManualSelected = selectedId === sister.id
              const isAutoSelected = !isManualSelected && autoSelectedId === sister.id
              const isOrchestrating = orchestrating && orchestratingSisterIds?.includes(sister.id)
              return (
                <button
                  key={sister.id}
                  type="button"
                  onClick={() => {
                    onSelect(isManualSelected ? null : sister.id)
                    handleClose()
                  }}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors',
                    isManualSelected
                      ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] text-[var(--theme-text)]'
                      : isAutoSelected && !isOrchestrating
                        ? 'border-[var(--theme-muted)] bg-[var(--theme-bg)] text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]'
                        : isOrchestrating
                          ? 'border-[var(--theme-amber)] bg-[var(--theme-amber-soft)] text-[var(--theme-text)]'
                          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <span className="text-xs">{sister.emoji}</span>
                  <span className="ml-1 text-xs">{sister.name}</span>
                  {isAutoSelected && !isOrchestrating && (
                    <span className="text-[9px] opacity-60 ml-0.5">auto</span>
                  )}
                  {isOrchestrating && (
                    <span className="text-[9px] opacity-70 ml-0.5">✦</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Reset to auto-routing button (if we have a manual selection) */}
        {selectedId && (
          <button
            type="button"
            onClick={() => {
              onSelect(null)
              handleClose()
            }}
            className="text-xs text-muted-foreground hover:text-foreground ml-1 px-1"
            title="Reset to auto-routing"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
