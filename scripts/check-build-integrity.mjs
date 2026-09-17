#!/usr/bin/env node
/**
 * Verify a freshly built SSR shell and client asset directory before deploy.
 * This catches partial builds where SSR references hashed files absent from
 * dist/client/assets.
 */
import { spawn } from 'node:child_process'
import { runAssetIntegrity } from './asset-integrity.mjs'

const port = Number(process.env.BUILD_INTEGRITY_PORT || 4317)
const baseUrl = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['server-entry.js'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  stdio: ['ignore', 'ignore', 'pipe'],
})

let stderr = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  stderr += chunk
})

async function waitForServer() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`, { cache: 'no-store' })
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`built server did not become ready${stderr ? `: ${stderr.trim()}` : ''}`)
}

try {
  await waitForServer()
  const result = await runAssetIntegrity(baseUrl)
  console.log(`build asset integrity passed: ${result.assetCount} local assets`)
} catch (error) {
  console.error(`build asset integrity failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  child.kill('SIGTERM')
}
