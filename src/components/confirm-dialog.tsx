/**
 * ConfirmDialog — shared confirm pattern used across the app:
 * fixed backdrop + centered card, Cancel (neutral) + confirm action
 * (destructive red by default). Extracted from the repeated inline
 * markup in tasks-screen.tsx (UI/UX audit §9.1).
 */
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Z_LAYER } from '@/lib/z-layers'

type ConfirmDialogProps = {
  title: ReactNode
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Red destructive styling for the confirm button (default true) */
  danger?: boolean
  /** Disables the confirm button, e.g. while a mutation is pending */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    cancelRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${Z_LAYER.modal}`}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        className="relative z-10 w-full max-w-xs bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-2xl p-5 flex flex-col gap-4"
      >
        <h2
          id={titleId}
          className="text-sm font-semibold text-[var(--theme-text)]"
        >
          {title}
        </h2>
        {body ? (
          <p id={bodyId} className="text-[11px] text-[var(--theme-muted)]">
            {body}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] px-3 py-2 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={
              danger
                ? 'flex-1 text-xs rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)]'
                : 'flex-1 text-xs rounded-lg border border-[var(--theme-accent)]/40 bg-[var(--theme-accent-soft)] px-3 py-2 text-[var(--theme-accent)] hover:opacity-80 transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)]'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
