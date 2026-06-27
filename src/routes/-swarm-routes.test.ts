import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('swarm routes stay client-only to avoid hydration/loading loops', () => {
  it('disables SSR for the canonical /swarm route', () => {
    const source = readFileSync('src/routes/swarm.tsx', 'utf8')
    expect(source).toContain("createFileRoute('/swarm')")
    expect(source).toContain('ssr: false')
    expect(source).toContain('Loading swarm...')
  })

  it('redirects /swarm2 to /swarm (duplicate route removed)', () => {
    const source = readFileSync('src/routes/swarm2.tsx', 'utf8')
    expect(source).toContain("createFileRoute('/swarm2')")
    expect(source).toContain("to: '/swarm'")
  })
})
