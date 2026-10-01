import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('deployment security gate CLI', () => {
  it('returns machine-readable failure output for an unsafe SHA', () => {
    let error
    try {
      execFileSync(process.execPath, ['scripts/deployment-security-gate.mjs', '--json', 'not-a-sha'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (caught) {
      error = caught
    }
    expect(error?.status).toBe(1)
    expect(JSON.parse(error?.stdout)).toEqual({
      ok: false,
      error: 'unsafe deployment SHA: not-a-sha',
    })
  })
})
