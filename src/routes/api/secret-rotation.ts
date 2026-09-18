import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAuthenticated } from '../../server/auth-middleware'

const execFileAsync = promisify(execFile)

async function readRotationStatus() {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/secrets-rotation.mjs', 'status'],
    { cwd: process.cwd(), timeout: 10_000, maxBuffer: 512 * 1024 },
  )
  const report = JSON.parse(stdout) as {
    status?: Array<{ state: string; owner?: string | null; source?: string | null }>
  }
  const statuses = report.status ?? []
  return {
    statuses,
    summary: {
      tracked: statuses.filter((entry) => entry.owner && entry.source).length,
      expired: statuses.filter((entry) => entry.state === 'expired').length,
      expiring: statuses.filter((entry) => entry.state === 'expiring').length,
      untracked: statuses.filter((entry) => entry.state === 'untracked').length,
    },
  }
}

export const Route = createFileRoute('/api/secret-rotation')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return json(
            { ok: true, generatedAt: new Date().toISOString(), ...(await readRotationStatus()) },
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch {
          return json(
            { ok: false, error: 'Credential rotation status unavailable' },
            { status: 500 },
          )
        }
      },
    },
  },
})
