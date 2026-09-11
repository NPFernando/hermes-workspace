#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const routesDir = path.resolve('src/routes/api')

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(filePath))
    else if (entry.name.endsWith('.ts')) files.push(filePath)
  }
  return files
}

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

const unguarded = []
let parsedRoutes = 0
for (const filePath of walk(routesDir)) {
  const source = readFileSync(filePath, 'utf8')
  const segments = handlerSegments(source)
  const jsonHandlers = segments.filter((segment) =>
    segment.source.includes('request.json()'),
  )

  if (jsonHandlers.length > 0) {
    parsedRoutes += jsonHandlers.length
    for (const handler of jsonHandlers) {
      if (
        !handler.source.includes('requireJsonContentType') &&
        !handler.source.includes('requireDifyJson')
      ) {
        unguarded.push(
          `${path.relative(process.cwd(), filePath)} (${handler.method})`,
        )
      }
    }
    continue
  }

  // Keep a conservative fallback for unusual route shapes where a JSON
  // parser is outside a named HTTP handler (or the file uses a helper).
  if (
    source.includes('request.json()') &&
    !source.includes('requireJsonContentType') &&
    !source.includes('requireDifyJson')
  ) {
    parsedRoutes++
    unguarded.push(path.relative(process.cwd(), filePath))
  }
}

if (unguarded.length > 0) {
  console.error('JSON API guard check failed:')
  for (const file of unguarded) console.error(`- ${file}`)
  process.exit(1)
}

console.log(
  `JSON API guard check passed (${parsedRoutes} JSON-parsing handlers; Dify-specific guards accepted).`,
)
