import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Z_LAYER } from '@/lib/z-layers'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(container: HTMLElement): Array<HTMLElement> {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
}

export function DashboardDialog({
  titleId,
  onClose,
  children,
  className,
}: {
  titleId: string
  onClose: () => void
  children?: ReactNode
  className: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const focusFrame = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog) return
      const first = focusableElements(dialog)[0] ?? dialog
      first.focus()
    })

    const restoreFocus = () => {
      const previous = previousFocusRef.current
      if (!previous?.isConnected) return
      previous.focus()
      requestAnimationFrame(() => {
        if (previous.isConnected && document.activeElement !== previous) {
          previous.focus()
        }
      })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        restoreFocus()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = focusableElements(dialog)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousBodyOverflow
      restoreFocus()
    }
  }, [])

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/65 px-4 py-6 ${Z_LAYER.modal}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={className}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
