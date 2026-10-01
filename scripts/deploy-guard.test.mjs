import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

// Every fixture() call leaked its mkdtempSync() directory permanently — no
// cleanup existed anywhere in this file. Found via 84 unremoved
// /tmp/hermes-deploy-guard-* directories accumulated in under an hour, one
// per test run (each run creates 2, one per `it` below). afterEach here
// removes whatever the just-finished test created, regardless of which
// `it` ran or whether it threw.
const fixtureRoots = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hermes-deploy-guard-'))
  fixtureRoots.push(root)
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
  writeFileSync(join(bin, 'pnpm'), `#!/bin/sh
if [ "$1" = "build" ]; then
  printf 'new build\\n' > "${join(root, 'dist/server/server.js')}"
fi
exit 0
`)
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 0\n')
  writeFileSync(join(bin, 'node'), `#!/bin/sh
if [ "$1" = "scripts/release-checklist.mjs" ]; then
  touch "${join(root, 'release-checklist.ran')}"
fi
if [ "${'${DEPLOY_TEST_FAIL_SMOKE:-0}'}" = "1" ] && { [ "$1" = "scripts/release-smoke.mjs" ] || [ "$1" = "scripts/release-checklist.mjs" ]; } && [ ! -f "${join(root, 'smoke.failed')}" ]; then
  touch "${join(root, 'smoke.failed')}"
  exit 1
fi
exit 0
`)
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n')
  writeFileSync(join(bin, 'systemctl'), `#!/bin/sh\nstate="${join(root, 'pid.state')}"\nif [ "$1" = "show" ]; then cat "$state"; exit 0; fi\nif [ "$1" = "restart" ]; then echo 456 > "$state"; exit 0; fi\nexit 0\n`)
  for (const name of ['pnpm', 'curl', 'node', 'sudo', 'systemctl']) chmodSync(join(bin, name), 0o755)
  writeFileSync(join(root, 'pid.state'), '123\n')
  return { root, script, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
}

const run = (f, ...args) => spawnSync('bash', [f.script, ...args], { cwd: f.root, encoding: 'utf8', env: f.env })

afterEach(() => {
  while (fixtureRoots.length > 0) {
    rmSync(fixtureRoots.pop(), { recursive: true, force: true })
  }
})

describe('deploy local-ahead guard', () => {
  it('previews a release without changing the artifact or restarting the service', () => {
    const f = fixture()
    const before = readFileSync(join(f.root, 'dist/server/server.js'), 'utf8')
    const result = run(f, '--preview')
    assert.equal(result.status, 0, result.stderr)
    const preview = JSON.parse(result.stdout.trim())
    assert.equal(preview.preview, true)
    assert.equal(preview.action, 'deploy-target')
    assert.equal(preview.worktreeDirty, false)
    assert.equal(preview.changedFiles, 2)
    assert.deepEqual(preview.changedFileList, ['release.txt', 'scripts/deploy.sh'])
    assert.deepEqual(preview.changedRuntimeFiles, [])
    assert.deepEqual(preview.migrationFiles, [])
    assert.equal(preview.imageTags.current, null)
    assert.equal(preview.imageTags.target, null)
    assert.equal(preview.rollback.target, preview.current)
    assert.equal(preview.rollback.artifactAvailable, true)
    assert.equal(preview.rollback.service, 'hermes-workspace.service')
    assert.equal(preview.live.serviceActive, false)
    assert.equal(preview.live.coherent, false)
    assert.equal(preview.live.deploymentMarker, null)
    assert.equal(preview.live.servedBuild, null)
    assert.equal(preview.approval.required, true)
    assert.equal(preview.approval.status, 'not-requested')
    assert.equal(preview.securityEvidenceRequired, true)
    assert.equal(readFileSync(join(f.root, 'dist/server/server.js'), 'utf8'), before)
    assert.equal(readFileSync(join(f.root, 'pid.state'), 'utf8'), '123\n')
    assert.equal(existsSync(join(f.root, '.runtime/build-commit')), false)
  })

  it('rejects local-ahead releases without explicit approval', () => {
    const result = run(fixture())
    assert.equal(result.status, 1)
    assert.match(result.stderr, /rerun explicitly with --allow-local-ahead/)
  })

  it('deploys an explicitly approved local-ahead release', () => {
    const f = fixture()
    const result = run(f, '--allow-local-ahead')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /retaining explicitly approved local-ahead release/)
    assert.match(result.stdout, /service healthy \(pid=456\)/)
    assert.equal(readFileSync(join(f.root, 'release-checklist.ran'), 'utf8'), '')
  })

  it('restores the previous artifact when release validation fails', () => {
    const f = fixture()
    const failed = spawnSync('bash', [f.script, '--allow-local-ahead'], {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...f.env, DEPLOY_TEST_FAIL_SMOKE: '1' },
    })
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /restoring previous compiled artifact/)
    assert.match(failed.stderr, /rollback recovered the previous release/)
    assert.equal(readFileSync(join(f.root, 'dist/server/server.js'), 'utf8'), 'fixture build\n')
  })

  it('runs authenticated browser smoke after rollback when credentials are configured', () => {
    const f = fixture()
    const failed = spawnSync('bash', [f.script, '--allow-local-ahead'], {
      cwd: f.root,
      encoding: 'utf8',
      env: {
        ...f.env,
        DEPLOY_TEST_FAIL_SMOKE: '1',
        AUTH_E2E_PASSWORD: 'fixture-only-secret',
        AUTH_E2E_BASE_URL: 'http://fixture.invalid',
      },
    })
    assert.equal(failed.status, 1)
    assert.match(
      failed.stderr,
      /rollback recovered the previous release and passed authenticated browser smoke/,
    )
  })
})
