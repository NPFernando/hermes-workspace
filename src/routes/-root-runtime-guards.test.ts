import { describe, expect, it, vi } from 'vitest'
import { registerAppServiceWorker, wrapInlineScript } from './__root'

describe('root runtime guards', () => {
  it('wraps inline scripts in a top-level try/catch', () => {
    const wrapped = wrapInlineScript('window.answer = 42;')
    expect(wrapped).toContain('try {')
    expect(wrapped).toContain('window.answer = 42;')
    expect(wrapped).toContain("console.error('Inline bootstrap script failed'")
  })

  it('registers the versioned PWA service worker without purging caches', async () => {
    const register = vi.fn().mockResolvedValue(undefined)

    await expect(
      registerAppServiceWorker({
        serviceWorker: { register },
      }),
    ).resolves.toBeUndefined()

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })
})
