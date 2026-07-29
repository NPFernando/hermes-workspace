/**
 * GET /api/workspace/skills
 *
 * Lists installed skills from ~/.hermes/skills/ with name, description,
 * and path. Mirrors the skills API but scoped to the Hermes workspace.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

type SkillItem = {
  id: string
  name: string
  description: string
  path: string
  status: 'active'
}

const SKILL_FILE_NAMES = ['SKILL.md', 'DESCRIPTION.md', 'README.md']

function parseSkillName(dir: string, content: string): string {
  const nameMatch = content.match(/^name:\s*["']?(.+?)["']?\s*$/m)
  if (nameMatch?.[1]) return nameMatch[1].trim()
  return dir
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function parseSkillDescription(content: string): string {
  const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m)
  if (descMatch?.[1]) return descMatch[1].trim()
  // Fall back to first non-frontmatter paragraph
  const body = content.replace(/^---[\s\S]+?---/m, '').trim()
  const firstPara = body.split('\n').find((l) => l.trim() && !l.startsWith('#'))
  return firstPara?.trim() ?? ''
}

function listSkills(): Array<SkillItem> {
  const hermesHome = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
  const skillsDir = path.join(hermesHome, 'skills')

  if (!fs.existsSync(skillsDir)) return []

  const result: Array<SkillItem> = []

  for (const entry of fs.readdirSync(skillsDir)) {
    const entryPath = path.join(skillsDir, entry)
    try {
      const stat = fs.statSync(entryPath)
      if (!stat.isDirectory()) continue

      let skillFilePath: string | null = null
      let content = ''

      for (const fname of SKILL_FILE_NAMES) {
        const candidate = path.join(entryPath, fname)
        if (fs.existsSync(candidate)) {
          skillFilePath = candidate
          content = fs.readFileSync(candidate, 'utf-8')
          break
        }
      }

      if (!skillFilePath) continue

      result.push({
        id: entry,
        name: parseSkillName(entry, content),
        description: parseSkillDescription(content),
        path: skillFilePath,
        status: 'active',
      })
    } catch {
      // skip unreadable entries
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export const Route = createFileRoute('/api/workspace/skills')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, skills: listSkills() })
      },
    },
  },
})
