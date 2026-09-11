import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hermes-deploy-guard-'))
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'user.name', 'Deploy Guard Test')
  writeFileSync(join(root, '.gitignore'), '/origin.git\n/fake-bin\n/dist\n/pid.state\n')
  writeFileSync(join(root, 'release.txt'), 'base\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'base')
  const origin = join(root, 'origin.git')
  git(root, 'init', '--bare', '-q', origin)
  git(root, 'remote', 'add', 'origin', origin)
  git(root, 'push', '-q', '-u', 'origin', 'main')
  writeFileSync(join(root, 'release.txt'), 'local release\n')
  git(root, 'commit', '-qam', 'local release')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  const script = join(root, 'scripts/deploy.sh')
  cpSync(join(repoRoot, 'scripts/deploy.sh'), script)
  chmodSync(script, 0o755)
  git(root, 'add', 'scripts/deploy.sh')
  git(root, 'commit', '-qm', 'add deploy fixture')
  mkdirSync(join(root, 'dist/server'), { recursive: true })
  writeFileSync(join(root, 'dist/server/server.js'), 'fixture build\n')
  const bin = join(root, 'fake-bin')
  mkdirSync(bin)
  for (const name of ['pnpm', 'curl', 'node']) writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n')
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n')
  writeFileSync(join(bin, 'systemctl'), `#!/bin/sh\nstate="${join(root, 'pid.state')}"\nif [ "$1" = "show" ]; then cat "$state"; exit 0; fi\nif [ "$1" = "restart" ]; then echo 456 > "$state"; exit 0; fi\nexit 0\n`)
  for (const name of ['pnpm', 'curl', 'node', 'sudo', 'systemctl']) chmodSync(join(bin, name), 0o755)
  writeFileSync(join(root, 'pid.state'), '123\n')
  return { root, script, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
}

const run = (f, ...args) => spawnSync('bash', [f.script, ...args], { cwd: f.root, encoding: 'utf8', env: f.env })

describe('deploy local-ahead guard', () => {
  it('rejects local-ahead releases without explicit approval', () => {
    const result = run(fixture())
    assert.equal(result.status, 1)
    assert.match(result.stderr, /rerun explicitly with --allow-local-ahead/)
  })

  it('deploys an explicitly approved local-ahead release', () => {
    const result = run(fixture(), '--allow-local-ahead')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /retaining explicitly approved local-ahead release/)
    assert.match(result.stdout, /service healthy \(pid=456\)/)
  })
})
