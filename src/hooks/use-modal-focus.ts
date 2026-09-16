import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Focuses the first useful control and keeps keyboard focus inside a modal. */
export function useModalFocus<T extends HTMLElement>(
  onEscape: () => void,
  initialFocusRef?: React.RefObject<HTMLElement | null>,
  active = true,
) {
  const dialogRef = useRef<T>(null)
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape

  useEffect(() => {
    if (!active) return undefined
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusTarget =
      initialFocusRef?.current ?? dialog?.querySelector<HTMLElement>(FOCUSABLE)
    focusTarget?.focus()

    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [active, initialFocusRef])

  function onKeyDown(event: React.KeyboardEvent<T>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      escapeRef.current()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
    )
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
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

  return { dialogRef, onKeyDown }
}
