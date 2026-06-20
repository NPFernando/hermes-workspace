import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'

/**
 * Hook to handle global keyboard shortcuts for screen navigation.
 * - Ctrl+1: Navigate to Chat screen
 * - Ctrl+2: Navigate to Tasks screen
 * - Ctrl+3: Navigate to Agora screen
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if an input or contenteditable is focused
      if (_isInputFocused()) return

      // Ctrl+1 (Chat)
      if (event.ctrlKey && event.key === '1') {
        event.preventDefault()
        navigate({ to: '/chat', replace: false })
      }
      // Ctrl+2 (Tasks)
      if (event.ctrlKey && event.key === '2') {
        event.preventDefault()
        navigate({ to: '/tasks', replace: false })
      }
      // Ctrl+3 (Agora)
      if (event.ctrlKey && event.key === '3') {
        event.preventDefault()
        navigate({ to: '/agora', replace: false })
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [navigate])
}

function _isInputFocused(): boolean {
  const active = document.activeElement
  if (!active) return false
  const tag = active.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea') return true
  if ((active as HTMLElement).isContentEditable) return true
  return false
}