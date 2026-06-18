/**
 * GET /api/workspace/skills/:skillId/content
 *
 * Returns the raw markdown content of a skill's definition file
 * (SKILL.md, DESCRIPTION.md, or README.md) from ~/.hermes/skills/:skillId/.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const SKILL_FILE_NAMES = ['SKILL.md', 'DESCRIPTION.md', 'README.md']

function readSkillContent(skillId: string): string | null {
  // Sanitize: only allow alphanumeric, hyphen, underscore
  if (!/^[\w-]+$/.test(skillId)) return null

  const hermesHome = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
  const skillDir = path.join(hermesHome, 'skills', skillId)

  if (!fs.existsSync(skillDir)) return null

  for (const fname of SKILL_FILE_NAMES) {
    const candidate = path.join(skillDir, fname)
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, 'utf-8')
      }
    } catch {
      // try next
    }
  }

  return null
}

export const Route = createFileRoute('/api/workspace/skills/$skillId/content')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const skillId = params.skillId
        const content = readSkillContent(skillId)

        if (content === null) {
          return json({ ok: false, error: `Skill '${skillId}' not found` }, { status: 404 })
        }

        return json({ ok: true, content })
      },
    },
  },
})
