import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('new-session launch experience', () => {
  it('does not use the fixed full-screen chat skeleton overlay', () => {
    const source = readSource('src/screens/chat/chat-screen.tsx')

    expect(source).not.toContain('showSkeleton')
    expect(source).not.toContain('components/Skeleton')
    expect(source).toContain('recentSessions={sessions}')
    expect(source).toContain('onOpenSession={(key)')
    expect(source).toContain('onStartBlank={()')
  })

  it('exposes recent sessions and starter prompts in the empty state', () => {
    const source = readSource(
      'src/screens/chat/components/chat-empty-state.tsx',
    )

    expect(source).toContain('Session Launch')
    expect(source).toContain('Recent')
    expect(source).toContain('Starters')
    expect(source).toContain('visibleRecentSessions')
    expect(source).toContain('onSuggestionClick?.(suggestion.prompt)')
  })

  it('registers a first-class New Session command palette action', () => {
    const source = readSource('src/components/command-palette.tsx')

    expect(source).toContain("id: 'action-new-session'")
    expect(source).toContain("group: 'Actions'")
    expect(source).toContain("label: 'New Session'")
    expect(source).toContain("params: { sessionKey: 'new' }")
  })
})
