import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function runGit(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function createAheadFixture() {
  const root = mkdtempSync(join(tmpdir(), 'hermes-deploy-guard-'))
  runGit(root, 'init', '-q', '-b', 'main')
  runGit(root, 'config', 'user.email', 'test@example.invalid')
  runGit(root, 'config', 'user.name', 'Deploy Guard Test')

  writeFileSync(
    join(root, '.gitignore'),
    '/origin.git\n/fake-bin\n/dist\n/pid.state\n',
  )
  writeFileSync(join(root, 'release.txt'), 'base\n')
  runGit(root, 'add', '.gitignore', 'release.txt')
  runGit(root, 'commit', '-qm', 'base')

  const bare = join(root, 'origin.git')
  runGit(root, 'init', '--bare', '-q', bare)
  runGit(root, 'remote', 'add', 'origin', bare)
  runGit(root, 'push', '-q', '-u', 'origin', 'main')

  writeFileSync(join(root, 'release.txt'), 'local release\n')
  runGit(root, 'commit', '-qam', 'local release')

  const script = join(root, 'scripts', 'deploy.sh')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  cpSync(join(repoRoot, 'scripts', 'deploy.sh'), script)
  chmodSync(script, 0o755)
  runGit(root, 'add', 'scripts/deploy.sh')
  runGit(root, 'commit', '-qm', 'add deploy fixture')
  mkdirSync(join(root, 'dist', 'server'), { recursive: true })
  writeFileSync(join(root, 'dist', 'server', 'server.js'), 'fixture build\n')

  const fakeBin = join(root, 'fake-bin')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 0\n')
  writeFileSync(join(fakeBin, 'curl'), '#!/bin/sh\nexit 0\n')
  writeFileSync(join(fakeBin, 'node'), '#!/bin/sh\nexit 0\n')
  writeFileSync(join(fakeBin, 'sudo'), '#!/bin/sh\nexec "$@"\n')
  writeFileSync(
    join(fakeBin, 'systemctl'),
    `#!/bin/sh
state="${join(root, 'pid.state')}"
if [ "$1" = "show" ]; then cat "$state"; exit 0; fi
if [ "$1" = "restart" ]; then echo 456 > "$state"; exit 0; fi
exit 0
`,
  )
  for (const name of ['pnpm', 'curl', 'node', 'sudo', 'systemctl']) {
    chmodSync(join(fakeBin, name), 0o755)
  }
  writeFileSync(join(root, 'pid.state'), '123\n')

  return { root, script, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } }
}

function runDeploy(fixture, ...args) {
  return spawnSync('bash', [fixture.script, ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: fixture.env,
  })
}

describe('deploy local-ahead guard', () => {
  it('rejects a local-ahead checkout without explicit approval', () => {
    const fixture = createAheadFixture()
    const result = runDeploy(fixture)

    assert.equal(result.status, 1)
    assert.match(result.stderr, /rerun explicitly with --allow-local-ahead/)
  })

  it('builds and restarts an explicitly approved local-ahead checkout', () => {
    const fixture = createAheadFixture()
    const result = runDeploy(fixture, '--allow-local-ahead')

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /retaining explicitly approved local-ahead release/)
    assert.match(result.stdout, /service healthy \(pid=456\)/)
  })
})
