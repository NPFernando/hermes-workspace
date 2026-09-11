// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { getTheme, isValidTheme, setTheme } from './theme'

describe('workspace theme defaults', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
  })

  it('uses the branded Nous palette for a new workspace', () => {
    expect(getTheme()).toBe('claude-nous')
  })

  it('falls back to Nous when a stored theme is invalid', () => {
    localStorage.setItem('claude-theme', 'not-a-theme')
    expect(getTheme()).toBe('claude-nous')
  })

  it('preserves an explicitly selected alternate theme', () => {
    localStorage.setItem('claude-theme', 'odysseus')
    expect(getTheme()).toBe('odysseus')
    expect(isValidTheme('odysseus')).toBe(true)
  })

  it('applies and persists a selected theme', () => {
    setTheme('claude-nous-light')
    expect(getTheme()).toBe('claude-nous-light')
    expect(document.documentElement.dataset.theme).toBe('claude-nous-light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })
})
