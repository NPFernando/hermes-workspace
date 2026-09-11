import { describe, expect, it } from 'vitest'
import { runReleaseSmoke } from './release-smoke.mjs'

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('release smoke', () => {
  it('accepts a healthy process serving the expected build', async () => {
    const fetchImpl = async (url) => url.endsWith('/api/auth-check')
      ? response(503, { authenticated: false })
      : response(200, { ok: true }, { 'x-workspace-build': 'build-1' })
    await expect(runReleaseSmoke('http://example.test', fetchImpl, 'build-1')).resolves.toMatchObject({ rootStatus: 200, authStatus: 503 })
  })

  it('rejects a stale artifact', async () => {
    const fetchImpl = async () => response(200, { ok: true }, { 'x-workspace-build': 'old-build' })
    await expect(runReleaseSmoke('http://example.test', fetchImpl, 'new-build')).rejects.toThrow(/build mismatch/)
  })
})
