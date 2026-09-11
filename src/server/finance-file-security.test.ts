import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFinanceFilePath } from './finance-file-security'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('resolveFinanceFilePath', () => {
  it('allows regular files inside the finance root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-files-'))
    tempDirs.push(root)
    const file = path.join(root, 'receipt.png')
    fs.writeFileSync(file, 'safe')
    expect(resolveFinanceFilePath(file, root)).toBe(file)
  })

  it('rejects traversal and symlinks escaping the finance root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-files-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-outside-'))
    tempDirs.push(root, outside)
    const file = path.join(outside, 'secret.txt')
    fs.writeFileSync(file, 'secret')
    expect(resolveFinanceFilePath(path.join(root, '..', path.basename(outside), 'secret.txt'), root)).toBeNull()
    try {
      fs.symlinkSync(file, path.join(root, 'linked.txt'))
      expect(resolveFinanceFilePath(path.join(root, 'linked.txt'), root)).toBeNull()
    } catch {
      // Symlinks may be unavailable on restricted Windows test runners.
    }
  })

  it('rejects directories and missing files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-files-'))
    tempDirs.push(root)
    expect(resolveFinanceFilePath(root, root)).toBeNull()
    expect(resolveFinanceFilePath(path.join(root, 'missing'), root)).toBeNull()
  })
})
