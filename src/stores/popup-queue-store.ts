import { useEffect } from 'react'
import { create } from 'zustand'

import { useChatActivityStore } from './chat-activity-store'

/**
 * Central popup arbitration. Two lanes:
 *
 *   modal  — blocking dialogs: one at a time, startup quiet period, a gap
 *            between consecutive modals, and deferred while the local chat
 *            UI is streaming a response. No preemption: an active modal
 *            keeps its slot until released.
 *   banner — docked strips: one at a time by priority, WITH preemption
 *            (a disconnect banner must beat a credits banner), no quiet
 *            period and no streaming deferral.
 *
 * Components ask for a slot with usePopupSlot()/useBannerSlot() and only
 * render their overlay while the hook returns true.
 */

export type PopupLane = 'modal' | 'banner'

type SlotRequest = {
  id: string
  priority: number
  requestedAt: number
}

const STARTUP_QUIET_MS = 4_000
const BETWEEN_MODALS_GAP_MS = 1_500
const RECHECK_MS = 500

type PopupQueueState = {
  requests: Record<PopupLane, Array<SlotRequest>>
  active: Record<PopupLane, string | null>
  quietUntil: number
  request: (lane: PopupLane, id: string, priority: number) => void
  release: (lane: PopupLane, id: string) => void
  _reconcile: () => void
}

function localChatIsBusy(): boolean {
  // Only the LOCAL chat activity defers popups — gateway activity can be a
  // long-running Telegram session that would postpone popups indefinitely.
  return useChatActivityStore.getState().localActivity !== 'idle'
}

let ticker: ReturnType<typeof setInterval> | null = null

function ensureTicker(store: { getState: () => PopupQueueState }) {
  if (ticker) return
  ticker = setInterval(() => {
    const state = store.getState()
    const hasPending =
      state.requests.modal.length > 0 || state.requests.banner.length > 0
    if (!hasPending) {
      if (ticker) clearInterval(ticker)
      ticker = null
      return
    }
    state._reconcile()
  }, RECHECK_MS)
}

export const usePopupQueueStore = create<PopupQueueState>()((set, get) => ({
  requests: { modal: [], banner: [] },
  active: { modal: null, banner: null },
  quietUntil: Date.now() + STARTUP_QUIET_MS,

  request: (lane, id, priority) => {
    set((state) => {
      if (state.requests[lane].some((r) => r.id === id)) return state
      return {
        requests: {
          ...state.requests,
          [lane]: [
            ...state.requests[lane],
            { id, priority, requestedAt: Date.now() },
          ],
        },
      }
    })
    get()._reconcile()
    ensureTicker({ getState: get })
  },

  release: (lane, id) => {
    set((state) => {
      const wasActive = state.active[lane] === id
      return {
        requests: {
          ...state.requests,
          [lane]: state.requests[lane].filter((r) => r.id !== id),
        },
        active: wasActive
          ? { ...state.active, [lane]: null }
          : state.active,
        // Leave a breather between consecutive modals
        quietUntil:
          wasActive && lane === 'modal'
            ? Date.now() + BETWEEN_MODALS_GAP_MS
            : state.quietUntil,
      }
    })
    get()._reconcile()
  },

  _reconcile: () => {
    const state = get()

    // Modal lane: activate highest-priority request when free and allowed
    if (state.active.modal === null && state.requests.modal.length > 0) {
      const allowed = Date.now() >= state.quietUntil && !localChatIsBusy()
      if (allowed) {
        const next = [...state.requests.modal].sort(
          (a, b) => b.priority - a.priority || a.requestedAt - b.requestedAt,
        )[0]
        set((s) => ({ active: { ...s.active, modal: next.id } }))
      }
    }

    // Banner lane: highest priority always wins (preemption allowed)
    if (state.requests.banner.length > 0) {
      const top = [...state.requests.banner].sort(
        (a, b) => b.priority - a.priority || a.requestedAt - b.requestedAt,
      )[0]
      if (state.active.banner !== top.id) {
        set((s) => ({ active: { ...s.active, banner: top.id } }))
      }
    } else if (state.active.banner !== null) {
      set((s) => ({ active: { ...s.active, banner: null } }))
    }
  },
}))

/**
 * Claim a slot in a popup lane while `wanted` is true. Returns true only
 * while this id holds the lane's active slot — render the overlay then.
 */
export function usePopupSlot(
  lane: PopupLane,
  id: string,
  priority: number,
  wanted: boolean,
): boolean {
  const request = usePopupQueueStore((s) => s.request)
  const release = usePopupQueueStore((s) => s.release)
  const activeId = usePopupQueueStore((s) => s.active[lane])

  useEffect(() => {
    if (!wanted) return
    request(lane, id, priority)
    return () => release(lane, id)
  }, [wanted, lane, id, priority, request, release])

  return wanted && activeId === id
}

export function useBannerSlot(
  id: string,
  priority: number,
  wanted: boolean,
): boolean {
  return usePopupSlot('banner', id, priority, wanted)
}
