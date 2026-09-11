#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const assetsDir = process.argv[2] || 'dist/client/assets'
const maxLargestJs = 1_500_000
const maxLargestCss = 800_000
const maxTotal = 14_000_000
const files = (await readdir(assetsDir)).filter((name) => /\.(js|css)$/.test(name))
const sizes = await Promise.all(files.map(async (name) => ({ name, size: (await stat(join(assetsDir, name))).size })))
const total = sizes.reduce((sum, file) => sum + file.size, 0)
const largestJs = Math.max(0, ...sizes.filter((file) => file.name.endsWith('.js')).map((file) => file.size))
const largestCss = Math.max(0, ...sizes.filter((file) => file.name.endsWith('.css')).map((file) => file.size))
console.log(`bundle budget: ${files.length} assets, ${(total / 1e6).toFixed(2)} MB total, largest JS ${(largestJs / 1e6).toFixed(2)} MB, largest CSS ${(largestCss / 1e6).toFixed(2)} MB`)
if (largestJs > maxLargestJs || largestCss > maxLargestCss || total > maxTotal) {
  console.error(`bundle budget exceeded (limits: JS ${maxLargestJs}, CSS ${maxLargestCss}, total ${maxTotal} bytes)`)
  process.exit(1)
}
