import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type NotificationCategory = 'updates' | 'changelog' | 'system'

export type CenterNotification = {
  /** Stable id — also the dedupe key across page loads */
  id: string
  category: NotificationCategory
  title: string
  body?: string
  createdAt: number
  read: boolean
  /** Serializable action rendered as the item's primary button */
  action?: 'open-update-digest'
}

export type NotificationPrefs = {
  /** Legacy behavior: pop the update digest modal on page load instead of
   * landing it silently in the inbox */
  autoPopupDigest: boolean
  /** Show a small toast when new items land in the inbox */
  toastOnNewItems: boolean
  /** Show the top-of-app "update available" cards */
  showUpdateCards: boolean
}

const MAX_ITEMS = 50

type NotificationCenterState = {
  items: Array<CenterNotification>
  prefs: NotificationPrefs
  panelOpen: boolean
  /** True while the update digest modal is open from the inbox/toast */
  digestOpen: boolean
  /** Insert an item unless an item with the same id exists. Returns true
   * when the item was newly inserted. */
  publish: (
    item: Omit<CenterNotification, 'createdAt' | 'read'> & {
      createdAt?: number
    },
  ) => boolean
  markRead: (id: string) => void
  markAllRead: () => void
  removeItem: (id: string) => void
  clearAll: () => void
  setPanelOpen: (open: boolean) => void
  setPref: <TKey extends keyof NotificationPrefs>(
    key: TKey,
    value: NotificationPrefs[TKey],
  ) => void
  openDigest: () => void
  closeDigest: () => void
}

export const useNotificationCenterStore = create<NotificationCenterState>()(
  persist(
    (set, get) => ({
      items: [],
      prefs: {
        autoPopupDigest: false,
        toastOnNewItems: true,
        showUpdateCards: true,
      },
      panelOpen: false,
      digestOpen: false,

      publish: (item) => {
        if (get().items.some((existing) => existing.id === item.id)) {
          return false
        }
        set((state) => ({
          items: [
            {
              ...item,
              createdAt: item.createdAt ?? Date.now(),
              read: false,
            },
            ...state.items,
          ].slice(0, MAX_ITEMS),
        }))
        return true
      },

      markRead: (id) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, read: true } : item,
          ),
        })),

      markAllRead: () =>
        set((state) => ({
          items: state.items.map((item) =>
            item.read ? item : { ...item, read: true },
          ),
        })),

      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),

      clearAll: () => set({ items: [] }),

      setPanelOpen: (open) => set({ panelOpen: open }),

      setPref: (key, value) =>
        set((state) => ({ prefs: { ...state.prefs, [key]: value } })),

      openDigest: () => set({ digestOpen: true, panelOpen: false }),
      closeDigest: () => set({ digestOpen: false }),
    }),
    {
      name: 'hermes-notification-center',
      partialize: (state) => ({ items: state.items, prefs: state.prefs }),
    },
  ),
)

export function useUnreadCount(): number {
  return useNotificationCenterStore(
    (state) => state.items.filter((item) => !item.read).length,
  )
}
