import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sisters-growth', () => ({
  getGrowthLevel: () => ({ level: 0, label: '', emoji: '', entryCount: 0 }),
  getGrowthLog: () => [],
}))

async function registryWith(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'sisters-'))
  mkdirSync(join(root, 'config'))
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(root, name), body)
  vi.stubEnv('HERMES_HOME', root)
  vi.resetModules()
  return import('./sisters-registry')
}

afterEach(() => vi.unstubAllEnvs())

describe('listSisters', () => {
  it('folds legacy delegation profiles into the AI sister with the same persona name', async () => {
    const registry = await registryWith({
      'config/sisters.yaml':
        'sisters:\n  ada:\n    name: Ada\n    role: coder\n  maya:\n    name: Maya\n',
      'sister_profiles.yaml':
        'coder:\n  name: "Ada"\n  role: coder\nbuilder:\n  name: "Maya"\nscout:\n  name: "Scout"\n',
    })
    const sisters = registry.listSisters(true)
    expect(sisters.map((s) => s.id).sort()).toEqual(['ada', 'maya', 'scout'])
    expect(sisters.filter((s) => s.name === 'Ada')).toHaveLength(1)
    expect(registry.getSisterById('coder')?.id).toBe('ada')
    expect(registry.getSisterById('builder')?.id).toBe('maya')
    expect(registry.getSisterById('scout')?.type).toBe('delegation_profile')
  })
})
