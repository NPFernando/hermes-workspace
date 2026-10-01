import { describe, expect, it } from 'vitest'
import { runReleaseSmoke } from './release-smoke.mjs'

function response(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

const shell = '<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/styles.css">'

describe('release smoke', () => {
  it('accepts a healthy process serving the expected build', async () => {
    const fetchImpl = async (url) => {
      const target = String(url)
      return target.endsWith('/api/auth-check')
      ? response(503, { authenticated: false })
      : target.endsWith('/assets/index.js') || target.endsWith('/assets/styles.css')
        ? response(200, '')
        : response(200, shell, { 'content-type': 'text/html', 'x-workspace-build': 'build-1' })
    }
    await expect(runReleaseSmoke('http://example.test', fetchImpl, 'build-1')).resolves.toMatchObject({ rootStatus: 200, authStatus: 503, assetCount: 2 })
  })

  it('rejects a stale artifact', async () => {
    const fetchImpl = async () => response(200, shell, { 'content-type': 'text/html', 'x-workspace-build': 'old-build' })
    await expect(runReleaseSmoke('http://example.test', fetchImpl, 'new-build')).rejects.toThrow(/build mismatch/)
  })

  it('explains missing assets as a stale build-manifest diagnosis', async () => {
    const fetchImpl = async (url) => {
      const target = String(url)
      return target.endsWith('/assets/index.js')
        ? response(404, '')
        : response(200, shell, { 'content-type': 'text/html', 'x-workspace-build': 'build-1' })
    }
    await expect(runReleaseSmoke('http://example.test', fetchImpl, 'build-1')).rejects.toThrow(
      /stale build manifest.*guarded deployment flow/,
    )
  })
})
