/**
 * ConfirmDialog — shared confirm pattern used across the app:
 * fixed backdrop + centered card, Cancel (neutral) + confirm action
 * (destructive red by default). Extracted from the repeated inline
 * markup in tasks-screen.tsx (UI/UX audit §9.1).
 */
import type { ReactNode } from 'react'

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-xs bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-2xl p-5 flex flex-col gap-4"
      >
        <p className="text-sm font-semibold text-[var(--theme-text)]">{title}</p>
        {body ? (
          <p className="text-[11px] text-[var(--theme-muted)]">{body}</p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] px-3 py-2 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={
              danger
                ? 'flex-1 text-xs rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40'
                : 'flex-1 text-xs rounded-lg border border-[var(--theme-accent)]/40 bg-[var(--theme-accent-soft)] px-3 py-2 text-[var(--theme-accent)] hover:opacity-80 transition-colors disabled:opacity-40'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
