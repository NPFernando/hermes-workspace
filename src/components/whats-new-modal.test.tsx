import { describe, expect, it } from 'vitest'

import { shouldShowWhatsNewModal } from './whats-new-modal'

describe("What's New route visibility", () => {
  it('waits until the user leaves chat before showing the modal', () => {
    expect(shouldShowWhatsNewModal('/chat/new')).toBe(false)
    expect(shouldShowWhatsNewModal('/dashboard')).toBe(true)
  })
})
