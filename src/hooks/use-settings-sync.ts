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

type GoogleProfile = {
  email?: string
  name?: string
  picture?: string
}

const DEBOUNCE_MS = 2000

export function useSettingsSync() {
  const applyingFromServer = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // On mount: pull settings + Google profile from server and hydrate local stores
  useEffect(() => {
    Promise.all([
      fetch('/api/user-settings')
        .then((r) => (r.ok ? (r.json() as Promise<SyncedSettings>) : null))
        .catch(() => null),
      fetch('/api/user-profile')
        .then((r) => (r.ok ? (r.json() as Promise<GoogleProfile>) : null))
        .catch(() => null),
    ]).then(([serverSettings, googleProfile]) => {
      applyingFromServer.current = true

      if (serverSettings && typeof serverSettings === 'object') {
        if (serverSettings.theme && isValidTheme(serverSettings.theme)) {
          setTheme(serverSettings.theme)
        }
        if (serverSettings.studioSettings) {
          useSettingsStore.getState().updateSettings(serverSettings.studioSettings)
        }
        if (serverSettings.chatSettings) {
          useChatSettingsStore.getState().updateSettings(serverSettings.chatSettings)
        }
      }

      // Auto-populate sidebar profile from Google if it's still the default identity
      if (googleProfile?.name || googleProfile?.picture) {
        const chat = useChatSettingsStore.getState().settings
        const updates: Partial<ChatSettings> = {}
        if (chat.displayName === 'User' && googleProfile.name) {
          updates.displayName = googleProfile.name
        }
        if (chat.avatarDataUrl === null && googleProfile.picture) {
          updates.avatarDataUrl = googleProfile.picture
        }
        if (Object.keys(updates).length > 0) {
          useChatSettingsStore.getState().updateSettings(updates)
          // Push merged settings to server; the subscribe guard is active so we do it directly
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
        }
      }

      setTimeout(() => {
        applyingFromServer.current = false
      }, 200)
    }).catch(() => {})
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
