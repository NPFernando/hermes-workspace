import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAuthenticated, requireLocalOrAuth } from '../../server/auth-middleware'
import { requireJsonContentType, safeErrorMessage } from '../../server/rate-limit'

const execFileAsync = promisify(execFile)

async function runReadiness(skipTests: boolean) {
  const args = ['scripts/production-readiness.mjs', '--json']
  if (skipTests) args.push('--skip-tests')
  const result = await execFileAsync(process.execPath, args, {
    cwd: process.cwd(),
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  return JSON.parse(result.stdout) as Record<string, unknown>
}

export const Route = createFileRoute('/api/production-readiness')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const url = new URL(request.url)
        const report = await runReadiness(url.searchParams.get('skipTests') === '1')
        return json({ ok: true, report })
      },
      POST: async ({ request }) => {
        if (!requireLocalOrAuth(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json().catch(() => ({}))) as { skipTests?: unknown }
          const report = await runReadiness(body.skipTests === true)
          return json({ ok: true, report })
        } catch (error) {
          return json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
        }
      },
    },
  },
})
