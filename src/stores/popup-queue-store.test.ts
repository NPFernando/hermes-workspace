import { beforeEach, describe, expect, it } from 'vitest'

import { usePopupQueueStore } from './popup-queue-store'

describe('popup queue store', () => {
  beforeEach(() => {
    usePopupQueueStore.setState({
      requests: { modal: [], banner: [] },
      active: { modal: null, banner: null },
      quietUntil: 0,
    })
  })

  it('activates a banner request immediately, highest priority first', () => {
    const { request } = usePopupQueueStore.getState()
    request('banner', 'credits', 50)
    expect(usePopupQueueStore.getState().active.banner).toBe('credits')
    // higher priority preempts
    request('banner', 'reconnect', 100)
    expect(usePopupQueueStore.getState().active.banner).toBe('reconnect')
    // releasing the winner falls back to the remaining request
    usePopupQueueStore.getState().release('banner', 'reconnect')
    expect(usePopupQueueStore.getState().active.banner).toBe('credits')
  })

  it('modal lane honors the quiet period then activates', () => {
    usePopupQueueStore.setState({ quietUntil: Date.now() + 60_000 })
    const { request } = usePopupQueueStore.getState()
    request('modal', 'digest', 100)
    expect(usePopupQueueStore.getState().active.modal).toBeNull()
    // quiet period over — the next reconcile tick activates the request
    usePopupQueueStore.setState({ quietUntil: Date.now() - 1 })
    usePopupQueueStore.getState()._reconcile()
    expect(usePopupQueueStore.getState().active.modal).toBe('digest')
  })

  it('modal lane runs one at a time without preemption', () => {
    const { request } = usePopupQueueStore.getState()
    request('modal', 'first', 10)
    expect(usePopupQueueStore.getState().active.modal).toBe('first')
    request('modal', 'second', 999)
    expect(usePopupQueueStore.getState().active.modal).toBe('first')
    usePopupQueueStore.getState().release('modal', 'first')
    // gap: not immediately active
    expect(usePopupQueueStore.getState().active.modal).toBeNull()
  })
})
