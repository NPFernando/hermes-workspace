import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAgentViewStore } from '@/hooks/use-agent-view'

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
  const availableSisters = useMemo(
    () => Array.from(new Map(sisters.map((sister) => [sister.id, sister])).values()),
    [sisters],
  )

  // Determine the current sister to display in the chip
  let currentSister: SisterOption | null = null
  if (selectedId) {
    currentSister = availableSisters.find((s) => s.id === selectedId) ?? null
  } else if (autoSelectedId) {
    currentSister = availableSisters.find((s) => s.id === autoSelectedId) ?? null
  }

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const agentCount = useAgentViewStore((s) => s.activeCount)
  const openPanel = useAgentViewStore((s) => s.setOpen)

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  useEffect(() => {
    if (anchorEl) {
      const handleClickOutside = (event: MouseEvent) => {
        if (!containerRef.current?.contains(event.target as Node)) {
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

  if (availableSisters.length === 0) return null

  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <span className="text-xs text-muted-foreground mr-1 shrink-0">Agent:</span>
      {orchestrating && !orchestratingSisterIds?.length && (
        <span className="text-xs text-muted-foreground animate-pulse mr-1">🌟 Astra orchestrating…</span>
      )}
      {agentCount > 0 && (
        <button
          type="button"
          onClick={() => openPanel(true)}
          className="flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1.5 sm:py-0.5 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 shrink-0 touch-manipulation"
          title="Open agent view"
        >
          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {agentCount}
        </button>
      )}
      <div ref={containerRef} className="relative">
        {/* Anchor for the popover */}
        <button
          type="button"
          ref={triggerRef}
          onClick={handleClick}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchorEl)}
          aria-label={`Choose agent, current: ${currentSister?.name ?? 'Auto'}`}
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
        </button>

        {/* Popover menu — opens upward since trigger sits above the composer at the bottom of the screen */}
        {anchorEl && (
          <div
            className="absolute left-0 bottom-full mb-1 max-h-[min(60dvh,24rem)] w-[min(18rem,calc(100vw-1rem))] overflow-y-auto border border-[var(--theme-border)] bg-[var(--theme-card)] z-50 shadow-xl rounded-xl p-1 space-y-1"
            role="menu"
          >
            {availableSisters.map((sister) => {
              const isManualSelected = selectedId === sister.id
              const isAutoSelected = !isManualSelected && autoSelectedId === sister.id
              const isOrchestrating = orchestrating && orchestratingSisterIds?.includes(sister.id)
              return (
                <button
                  key={sister.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isManualSelected}
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
                  <span className="sr-only">{sister.description}</span>
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
