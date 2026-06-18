import { useEffect, useRef } from 'react'
import type { ChatSettings } from '@/hooks/use-chat-settings'
import type { StudioSettings } from '@/hooks/use-settings'
import { getTheme, isValidTheme, setTheme } from '@/lib/theme'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
import { useSettingsStore } from '@/hooks/use-settings'

type SyncedSettings = {
  theme?: string
  studioSettings?: Partial<StudioSettings>
  chatSettings?: Partial<ChatSettings>
}

const DEBOUNCE_MS = 2000

export function useSettingsSync() {
  const applyingFromServer = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // On mount: pull settings from server and hydrate local stores
  useEffect(() => {
    fetch('/api/user-settings')
      .then((r) => {
        if (!r.ok) return null
        return r.json() as Promise<SyncedSettings>
      })
      .then((serverSettings) => {
        if (!serverSettings || typeof serverSettings !== 'object') return

        applyingFromServer.current = true

        if (serverSettings.theme && isValidTheme(serverSettings.theme)) {
          setTheme(serverSettings.theme)
        }
        if (serverSettings.studioSettings) {
          useSettingsStore.getState().updateSettings(serverSettings.studioSettings)
        }
        if (serverSettings.chatSettings) {
          useChatSettingsStore.getState().updateSettings(serverSettings.chatSettings)
        }

        setTimeout(() => { applyingFromServer.current = false }, 200)
      })
      .catch(() => {})
  }, [])

  // Subscribe to local store changes → debounce push to server
  useEffect(() => {
    function scheduleSync() {
      if (applyingFromServer.current) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const payload: SyncedSettings = {
          theme: getTheme(),
          studioSettings: useSettingsStore.getState().settings,
          chatSettings: useChatSettingsStore.getState().settings,
        }
        fetch('/api/user-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {})
      }, DEBOUNCE_MS)
    }

    const unsubStudio = useSettingsStore.subscribe(scheduleSync)
    const unsubChat = useChatSettingsStore.subscribe(scheduleSync)

    return () => {
      unsubStudio()
      unsubChat()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])
}
