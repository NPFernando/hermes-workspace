import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'
import { invalidateSistersCache, listSisters } from '../../server/sisters-registry'
import {
  
  appendGrowthEntry,
  isValidCronExpr,
  registerSisterCron,
  updateSisterDescription
} from '../../server/sisters-growth'
import type {SisterCronRequest} from '../../server/sisters-growth';

type ImproveBody = {
  id?: unknown
  note?: unknown
  description?: unknown
  cron?: unknown
}

type CronInput = {
  name?: unknown
  schedule?: unknown
  prompt?: unknown
  skills?: unknown
  deliver?: unknown
  toolsets?: unknown
  profile?: unknown
}

export const Route = createFileRoute('/api/sisters-improve')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`sisters-improve:${getClientIp(request)}`, 30, 60_000)) {
          return rateLimitResponse()
        }

        let body: ImproveBody
        try {
          body = (await request.json()) as ImproveBody
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (!id) {
          return json({ ok: false, error: 'id is required' }, { status: 400 })
        }

        // Verify sister exists
        const sisters = listSisters()
        const sister = sisters.find((s) => s.id === id)
        if (!sister) {
          return json({ ok: false, error: `Sister '${id}' not found` }, { status: 404 })
        }

        const results: Array<string> = []

        // Add personality note
        if (typeof body.note === 'string' && body.note.trim()) {
          const note = body.note.trim().slice(0, 2000)
          appendGrowthEntry(id, {
            type: 'note',
            content: note,
            author: id,
          })
          results.push('note')
        }

        // Update description
        if (typeof body.description === 'string' && body.description.trim()) {
          const desc = body.description.trim().slice(0, 500)
          updateSisterDescription(id, desc)
          appendGrowthEntry(id, {
            type: 'description',
            content: desc,
            author: id,
          })
          results.push('description')
        }

        // Register a new cron job
        if (body.cron && typeof body.cron === 'object') {
          const c = body.cron as CronInput
          const name = typeof c.name === 'string' ? c.name.trim() : ''
          const schedule = typeof c.schedule === 'string' ? c.schedule.trim() : ''
          const prompt = typeof c.prompt === 'string' ? c.prompt.trim() : ''

          if (!name || !schedule || !prompt) {
            return json(
              { ok: false, error: 'cron.name, cron.schedule, and cron.prompt are required' },
              { status: 400 },
            )
          }
          if (!isValidCronExpr(schedule)) {
            return json(
              { ok: false, error: `Invalid cron expression: ${schedule}` },
              { status: 400 },
            )
          }

          const skills =
            Array.isArray(c.skills) && c.skills.every((s) => typeof s === 'string')
              ? (c.skills)
              : []
          const deliver = typeof c.deliver === 'string' ? c.deliver : 'local'
          const toolsets =
            Array.isArray(c.toolsets) && c.toolsets.every((s) => typeof s === 'string')
              ? (c.toolsets)
              : undefined
          const profile = typeof c.profile === 'string' ? c.profile : id

          const req: SisterCronRequest = {
            name: name.slice(0, 80),
            schedule,
            prompt: prompt.slice(0, 4000),
            skills,
            deliver,
            toolsets,
            profile,
          }

          const { id: cronId } = registerSisterCron(id, req)
          appendGrowthEntry(id, {
            type: 'cron',
            content: `Created cron "${name}" — ${schedule}: ${prompt.slice(0, 100)}`,
            author: id,
          })
          results.push(`cron:${cronId}`)
        }

        if (results.length === 0) {
          return json(
            { ok: false, error: 'Provide at least one of: note, description, cron' },
            { status: 400 },
          )
        }

        // Invalidate sister cache so next GET /api/sisters returns updated growth level
        invalidateSistersCache()

        return json({ ok: true, updated: results })
      },
    },
  },
})
