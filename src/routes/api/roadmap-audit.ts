import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

const execFileAsync = promisify(execFile)

async function runRoadmapAudit() {
  try {
    const result = await execFileAsync(
      process.execPath,
      ['scripts/roadmap-completion-audit.mjs'],
      { cwd: process.cwd(), timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    )
    return JSON.parse(result.stdout)
  } catch (error) {
    const output = error as { stdout?: string }
    if (output.stdout) return JSON.parse(output.stdout)
    throw error
  }
}

export const Route = createFileRoute('/api/roadmap-audit')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const report = await runRoadmapAudit()
          return json(
            { ok: true, report },
            { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' } },
          )
        } catch {
          return json({ ok: false, error: 'Roadmap audit unavailable' }, { status: 503 })
        }
      },
    },
  },
})
