#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const routesDir = path.resolve('src/routes/api')
const mutationHandler = /\b(?:POST|PUT|PATCH|DELETE)\s*:/
const authMarkers = [
  /isAuthenticated\s*\(/,
  /requireLocalOrAuth\s*\(/,
  /requireDifyJson\s*\(/,
  /getBearerToken\s*\(/,
  /BEARER_TOKEN\b/,
  /handleHermesConfigPatch\b/,
]
const bootstrapRoutes = new Set(['src/routes/api/auth.ts'])

function handlerHasAuth(handler, fileSource) {
  if (authMarkers.some((marker) => marker.test(handler.source))) return true

  // Some proxy routes map every HTTP method to one shared named handler.
  // Resolve that local alias so authentication in the shared function is
  // attributed to each mutation method without falling back to file-wide
  // marker matching.
  const alias = handler.source.match(
    /^\s*(?:POST|PUT|PATCH|DELETE):\s*([A-Za-z_$][\w$]*)\s*,/,
  )?.[1]
  if (!alias) return false
  const functionStart = fileSource.indexOf(`function ${alias}`)
  if (functionStart < 0) return false
  return authMarkers.some((marker) =>
    marker.test(fileSource.slice(functionStart)),
  )
}

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(filePath))
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.'))
      files.push(filePath)
  }
  return files
}

const unguarded = []
let mutationHandlers = 0
for (const filePath of walk(routesDir)) {
  const source = readFileSync(filePath, 'utf8')
  if (bootstrapRoutes.has(path.relative(process.cwd(), filePath))) continue
  const handlers = [...source.matchAll(/^\s*(POST|PUT|PATCH|DELETE):/gm)].map(
    (match, index, matches) => ({
      method: match[1],
      source: source.slice(
        match.index,
        matches[index + 1]?.index ?? source.length,
      ),
    }),
  )
  if (handlers.length === 0 && !mutationHandler.test(source)) continue

  for (const handler of handlers) {
    mutationHandlers++
    if (!handlerHasAuth(handler, source)) {
      unguarded.push(
        `${path.relative(process.cwd(), filePath)} (${handler.method})`,
      )
    }
  }
}

if (unguarded.length > 0) {
  console.error('Mutation API auth check failed:')
  for (const file of unguarded) console.error(`- ${file}`)
  process.exit(1)
}

console.log(
  `Mutation API auth check passed (${mutationHandlers} mutation handlers).`,
)
