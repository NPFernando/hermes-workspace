import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Resolve a finance-served file through the filesystem, not just lexical
 * path normalization. This rejects traversal and symlinks that point outside
 * the private finance directory, and only permits regular files.
 */
export function resolveFinanceFilePath(
  candidate: string,
  allowedRoot: string,
): string | null {
  if (!candidate || !allowedRoot) return null
  try {
    const root = fs.realpathSync(allowedRoot)
    const resolved = fs.realpathSync(candidate)
    const relative = path.relative(root, resolved)
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    ) {
      return null
    }
    return fs.statSync(resolved).isFile() ? resolved : null
  } catch {
    return null
  }
}
