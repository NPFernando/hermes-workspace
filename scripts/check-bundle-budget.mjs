#!/usr/bin/env node
/** Guard the browser's initial asset budget after a production build. */
import { gzipSync } from 'node:zlib'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const assetDir = resolve('dist/client/assets')
const mainLimit = Number(process.env.BUNDLE_BUDGET_MAIN_BYTES || 1_100_000)
const mainGzipLimit = Number(
  process.env.BUNDLE_BUDGET_MAIN_GZIP_BYTES || 350_000,
)
const cssLimit = Number(process.env.BUNDLE_BUDGET_CSS_BYTES || 650_000)

const assets = await readdir(assetDir)
// TanStack/Vite has used both `main-*` and `index-*` for the browser entry
// across compatible releases. The entry is the largest of those candidates;
// route/vendor chunks have stable descriptive names and are intentionally not
// included in this initial-load budget.
const mainCandidates = assets.filter((name) =>
  /^(?:main|index)-[^/]+\.js$/.test(name),
)
let mainName
let mainSize = -1
for (const name of mainCandidates) {
  const size = (await readFile(join(assetDir, name))).length
  if (size > mainSize) {
    mainName = name
    mainSize = size
  }
}
const cssName = assets.find((name) => /^styles-[^/]+\.css$/.test(name))

if (!mainName || !cssName) {
  throw new Error('Could not locate the expected main JS and styles CSS assets')
}

const [main, css] = await Promise.all([
  readFile(join(assetDir, mainName)),
  readFile(join(assetDir, cssName)),
])
const mainGzip = gzipSync(main, { level: 9 }).length

console.log(
  `bundle budget: ${mainName} ${main.length} bytes (${mainGzip} gzip), ${cssName} ${css.length} bytes`,
)

const failures = []
if (main.length > mainLimit) failures.push(`main JS exceeds ${mainLimit} bytes`)
if (mainGzip > mainGzipLimit) {
  failures.push(`main JS gzip exceeds ${mainGzipLimit} bytes`)
}
if (css.length > cssLimit) failures.push(`styles CSS exceeds ${cssLimit} bytes`)

if (failures.length > 0) throw new Error(failures.join('; '))
