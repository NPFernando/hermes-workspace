import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let cached: string | null = null

/**
 * Resolve the hermes CLI path.
 *
 * The systemd service's PATH doesn't include ~/.local/bin (where hermes actually
 * lives), and several routes historically hardcoded
 * `~/.hermes/node_modules/.bin/hermes`, which does NOT exist — so their
 * `hermes send` calls silently failed (spawn ENOENT). Check known install
 * locations in priority order, then fall back to `which`, then the bare name.
 * Result is memoized.
 */
export function resolveHermesBin(): string {
  if (cached) return cached
  const home = os.homedir()
  const candidates = [
    process.env.HERMES_BIN,
    path.join(home, '.local', 'bin', 'hermes'),
    path.join(home, '.hermes', 'bin', 'hermes'),
    path.join(home, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
    '/usr/local/bin/hermes',
  ].filter(Boolean) as Array<string>
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cached = candidate
        return candidate
      }
    } catch {
      /* skip unreadable candidate */
    }
  }
  try {
    cached = spawnSync('which', ['hermes'], { encoding: 'utf-8' }).stdout.trim() || 'hermes'
  } catch {
    cached = 'hermes'
  }
  return cached
}
