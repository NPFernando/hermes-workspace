#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const apiDir = path.resolve('src/routes/api')
const routeFiles = fs
  .readdirSync(apiDir)
  .filter(
    (file) =>
      file.endsWith('.ts') && /^(?:tasks|hermes-tasks|claude-tasks)/.test(file),
  )

const jsonRoutes = []
const missingGuards = []

function handlerSegments(source) {
  const matches = [...source.matchAll(/^\s*(GET|POST|PUT|PATCH|DELETE):/gm)]
  return matches.map((match, index) => ({
    method: match[1],
    source: source.slice(
      match.index,
      matches[index + 1]?.index ?? source.length,
    ),
  }))
}

for (const file of routeFiles) {
  if (file.includes('.test.')) continue
  const filePath = path.join(apiDir, file)
  const source = fs.readFileSync(filePath, 'utf8')
  const handlers = handlerSegments(source).filter((handler) =>
    handler.source.includes('request.json()'),
  )
  for (const handler of handlers) {
    jsonRoutes.push(`${file} (${handler.method})`)
    if (!handler.source.includes('requireJsonContentType')) {
      missingGuards.push(`${file} (${handler.method})`)
    }
  }
}

if (missingGuards.length > 0) {
  console.error('Task routes parsing JSON without the CSRF content-type guard:')
  for (const file of missingGuards) console.error(`- src/routes/api/${file}`)
  process.exit(1)
}

console.log(
  `Task API guard check passed (${jsonRoutes.length} JSON-parsing handlers).`,
)
