import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'

const KeyboardShortcuts = () => {
  const navigate = useNavigate()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey
      if (!ctrl) return

      switch (event.key) {
        case 'n': {
          // Ctrl+N → new chat (only when not in an input/textarea)
          const tag = (event.target as HTMLElement).tagName
          if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(event.target as HTMLElement).isContentEditable) {
            event.preventDefault()
            void navigate({ to: '/chat/$sessionKey', params: { sessionKey: 'new' } })
          }
          break
        }
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [navigate])

  return null
}

export default KeyboardShortcuts
