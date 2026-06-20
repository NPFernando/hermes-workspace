/**
 * GET /api/workspace/memory-files
 *
 * Returns memory and context files visible to the workspace:
 *  - workspace  → ~/CLAUDE.md, hermes-workspace/CLAUDE.md
 *  - project    → project CLAUDE.md files under ~/workspace/
 *  - agent      → ~/.hermes/memories/MEMORY.md, sister MEMORY.md files
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

type MemorySection = 'workspace' | 'project' | 'agent'

type MemoryFileItem = {
  name: string
  path: string
  size: string
  section: MemorySection
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function tryStatFile(filePath: string): fs.Stats | null {
  try { return fs.statSync(filePath) } catch { return null }
}

function collectFiles(): Array<MemoryFileItem> {
  const home = os.homedir()
  const hermesHome = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(home, '.hermes')
  const result: Array<MemoryFileItem> = []

  function add(filePath: string, section: MemorySection) {
    const stat = tryStatFile(filePath)
    if (!stat?.isFile()) return
    result.push({
      name: path.basename(filePath),
      path: filePath,
      size: formatSize(stat.size),
      section,
    })
  }

  // Workspace memory: CLAUDE.md at root and workspace level
  add(path.join(home, 'CLAUDE.md'), 'workspace')
  add(path.join(home, 'hermes-workspace', 'CLAUDE.md'), 'workspace')
  add(path.join(hermesHome, 'SOUL.md'), 'workspace')

  // Claude Code memory (auto-memory from claude.ai/code)
  const claudeMemoryDir = path.join(home, '.claude', 'projects', '-home-ubuntu', 'memory')
  if (fs.existsSync(claudeMemoryDir)) {
    for (const f of fs.readdirSync(claudeMemoryDir)) {
      if (f.endsWith('.md')) add(path.join(claudeMemoryDir, f), 'workspace')
    }
  }

  // Project CLAUDE.md files
  const projectsDir = path.join(home, 'workspace', 'projects')
  if (fs.existsSync(projectsDir)) {
    for (const proj of fs.readdirSync(projectsDir).slice(0, 20)) {
      add(path.join(projectsDir, proj, 'CLAUDE.md'), 'project')
    }
  }
  const srvProjects = '/srv/projects'
  if (fs.existsSync(srvProjects)) {
    for (const proj of fs.readdirSync(srvProjects).slice(0, 10)) {
      add(path.join(srvProjects, proj, 'CLAUDE.md'), 'project')
    }
  }

  // Agent memory files
  add(path.join(hermesHome, 'memories', 'MEMORY.md'), 'agent')
  add(path.join(home, '.claude', 'projects', '-home-ubuntu', 'memory', 'MEMORY.md'), 'agent')

  const profilesDir = path.join(hermesHome, 'profiles')
  if (fs.existsSync(profilesDir)) {
    for (const profile of fs.readdirSync(profilesDir).slice(0, 15)) {
      add(path.join(profilesDir, profile, 'memory', 'MEMORY.md'), 'agent')
    }
  }

  // Deduplicate by path
  const seen = new Set<string>()
  return result.filter((f) => {
    if (seen.has(f.path)) return false
    seen.add(f.path)
    return true
  })
}

export const Route = createFileRoute('/api/workspace/memory-files')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, files: collectFiles() })
      },
    },
  },
})
