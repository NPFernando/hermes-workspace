import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const routePath = path.resolve(__dirname, 'files.tsx')
const sidebarPath = path.resolve(
  __dirname,
  '../components/file-explorer/file-explorer-sidebar.tsx',
)

describe('Files route responsive layout', () => {
  it('uses a mobile tree-to-editor flow', () => {
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain(
      "setFileExplorerCollapsed(isMobile ? Boolean(loaded?.path) : false)",
    )
    expect(source).toContain("if (isMobile) setFileExplorerCollapsed(true)")
    expect(source).toContain(
      "isMobile && !fileExplorerCollapsed ? '!w-full' : undefined",
    )
    expect(source).toMatch(
      /isMobile && !fileExplorerCollapsed\s+\? 'hidden'/,
    )
  })

  it('exposes a visible mobile close control in the file tree', () => {
    const source = fs.readFileSync(sidebarPath, 'utf8')

    expect(source).toContain('aria-label="Close files"')
    expect(source).toContain('className="md:hidden"')
  })
})
