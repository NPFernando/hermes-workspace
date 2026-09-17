import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const outputPath = resolve(root, 'electron/server-bundle.cjs')
const sourcePath = resolve(root, 'dist/server/server.js')

execFileSync(
  'pnpm',
  [
    'exec',
    'esbuild',
    sourcePath,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${outputPath}`,
  ],
  { cwd: root, stdio: 'inherit' },
)

let bundle = readFileSync(outputPath, 'utf8')

// TanStack Start records source filenames in its route manifest. Those paths
// are build metadata, not runtime file dependencies, but they otherwise make
// this checked-in Electron artifact depend on the CI checkout directory.
bundle = bundle.replaceAll(`${root}/src/routes/`, '/workspace/hermes-workspace/src/routes/')

// esbuild derives the internal module identifier from the path-sensitive
// manifest content. Keep the identifier stable after normalizing the paths.
bundle = bundle.replace(
  /init_tanstack_start_manifest_v_[A-Za-z0-9_]+/g,
  'init_hermes_route_manifest',
)
bundle = bundle.replace(
  /tanstack_start_manifest_v_[A-Za-z0-9_]+/g,
  'hermes_route_manifest',
)

writeFileSync(outputPath, bundle)
