import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyHarpPatch, getHarpConfigView, type HarpConfig } from './harp-config-store'

// candidatePaths() has hardcoded (env-ignoring) fallbacks like
// /srv/projects/_hermes-control/harp-config.yaml that may exist on the host, so
// createStarterHarpConfig() can't be trusted for isolation — seed the file
// directly at HARP_CONFIG_PATH (the first, highest-priority candidate).
const SEED: HarpConfig = {
  harp_vm: {
    enabled: true,
    mode: 'tiered_with_degradation',
    auto_route: true,
    route_delegation_only: false,
    allow_paid_benchmarking: false,
    paid_benchmark_daily_cap_usd: 0.1,
    require_paid_final_review_for_production: false,
  },
  routing: {
    strategy: 'tiered_with_degradation',
    free_first: true,
    tier1_free: { provider: 'openrouter', trigger: 'always', models: [{ model: 'x:free', role: 'primary' }] },
    tier2_paid: { provider: 'openrouter', trigger: ['tier1_exhausted'], models: [{ model: 'y', role: 'primary' }] },
  },
  routing_blocklist: [],
  auto_improve: { enabled: false, script: '', trigger: [], min_evals_to_rank: 3, report_dir: '', deliver: '' },
  combos: { enabled: false, enforce: false, entries: [] },
}

let tmpDir = ''
let cfgPath = ''
const originalEnv: Record<string, string | undefined> = {}

function setEnv(key: string, value: string | undefined) {
  if (!(key in originalEnv)) originalEnv[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function readCombosBlock(): Record<string, unknown> {
  const parsed = YAML.parse(fs.readFileSync(cfgPath, 'utf-8')) as HarpConfig
  return (parsed.combos ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harp-config-store-'))
  cfgPath = path.join(tmpDir, 'harp-config.yaml')
  setEnv('HARP_CONFIG_PATH', cfgPath)
  setEnv('HERMES_HOME', tmpDir)
  setEnv('CLAUDE_HOME', undefined)
  fs.writeFileSync(cfgPath, YAML.stringify(SEED), 'utf-8')
})

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const key of Object.keys(originalEnv)) delete originalEnv[key]
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('applyHarpPatch — route combos', () => {
  it('starter config includes an empty combos block; view surfaces it', () => {
    const view = getHarpConfigView()
    expect(view.combos).toEqual({ enabled: false, enforce: false, entries: [] })
  })

  it('add-combo / add-combo-step / reorder / remove round-trip through YAML', () => {
    expect(applyHarpPatch({ action: 'add-combo', name: 'cr' }).ok).toBe(true)
    expect(applyHarpPatch({ action: 'add-combo-step', name: 'cr', step: 'openrouter/a:free' }).ok).toBe(true)
    expect(applyHarpPatch({ action: 'add-combo-step', name: 'cr', step: 'openai-codex/gpt-5.5' }).ok).toBe(true)

    let entries = getHarpConfigView().combos.entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'cr', steps: ['openrouter/a:free', 'openai-codex/gpt-5.5'] })

    // reorder
    applyHarpPatch({ action: 'reorder-combo-steps', name: 'cr', steps: ['openai-codex/gpt-5.5', 'openrouter/a:free'] })
    expect(getHarpConfigView().combos.entries[0].steps).toEqual(['openai-codex/gpt-5.5', 'openrouter/a:free'])

    // remove one step
    applyHarpPatch({ action: 'remove-combo-step', name: 'cr', step: 'openrouter/a:free' })
    expect(getHarpConfigView().combos.entries[0].steps).toEqual(['openai-codex/gpt-5.5'])

    // remove the combo
    applyHarpPatch({ action: 'remove-combo', name: 'cr' })
    expect(getHarpConfigView().combos.entries).toEqual([])
  })

  it('add-combo rejects a duplicate or blank name', () => {
    applyHarpPatch({ action: 'add-combo', name: 'x' })
    expect(applyHarpPatch({ action: 'add-combo', name: 'x' })).toEqual({
      ok: false,
      error: 'Combo "x" already exists',
    })
    expect(applyHarpPatch({ action: 'add-combo', name: '   ' }).ok).toBe(false)
  })

  it('add-combo-step trims and dedupes', () => {
    applyHarpPatch({ action: 'add-combo', name: 'd' })
    applyHarpPatch({ action: 'add-combo-step', name: 'd', step: '  openrouter/a:free  ' })
    applyHarpPatch({ action: 'add-combo-step', name: 'd', step: 'openrouter/a:free' })
    expect(getHarpConfigView().combos.entries[0].steps).toEqual(['openrouter/a:free'])
  })

  it('rename-combo renames, rejects clashing name, no-ops on missing', () => {
    applyHarpPatch({ action: 'add-combo', name: 'old' })
    applyHarpPatch({ action: 'add-combo', name: 'taken' })
    expect(applyHarpPatch({ action: 'rename-combo', name: 'old', newName: 'taken' })).toEqual({
      ok: false,
      error: 'Combo "taken" already exists',
    })
    expect(applyHarpPatch({ action: 'rename-combo', name: 'old', newName: 'new' }).ok).toBe(true)
    expect(getHarpConfigView().combos.entries.map((c) => c.name).sort()).toEqual(['new', 'taken'])
    // missing combo: succeeds, no change
    expect(applyHarpPatch({ action: 'rename-combo', name: 'ghost', newName: 'z' }).ok).toBe(true)
  })

  it('set-combo-match writes only present keys and drops the block when both cleared', () => {
    applyHarpPatch({ action: 'add-combo', name: 'm' })
    applyHarpPatch({ action: 'set-combo-match', name: 'm', match: { task: 'code_review', risk: 'standard' } })
    expect(readCombosBlock().entries).toMatchObject([{ match: { task: 'code_review', risk: 'standard' } }])

    applyHarpPatch({ action: 'set-combo-match', name: 'm', match: { task: 'audit' } })
    expect(readCombosBlock().entries).toMatchObject([{ match: { task: 'audit' } }])
    expect((readCombosBlock().entries as Array<{ match?: { risk?: string } }>)[0].match?.risk).toBeUndefined()

    applyHarpPatch({ action: 'set-combo-match', name: 'm', match: {} })
    expect((readCombosBlock().entries as Array<{ match?: unknown }>)[0].match).toBeUndefined()
  })

  it('set-combos-global toggles enabled / enforce (coerced to bool)', () => {
    applyHarpPatch({ action: 'set-combos-global', field: 'enabled', value: true })
    applyHarpPatch({ action: 'set-combos-global', field: 'enforce', value: true })
    expect(getHarpConfigView().combos).toMatchObject({ enabled: true, enforce: true })
  })

  it('unknown patch action is rejected (no silent write)', () => {
    const res = applyHarpPatch({ action: 'totally-bogus' } as never)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('unknown patch action')
  })

  // Integration: the YAML this store writes must be readable by the actual
  // harp-select-route.py combo loader. Skipped when the engine repo isn't on
  // this host (CI).
  const SELECTOR =
    '/home/ubuntu/workspace/projects/universal-harp-engine/scripts/harp-select-route.py'
  const maybeIt = fs.existsSync(SELECTOR) ? it : it.skip
  maybeIt('round-trips into harp-select-route.py (shadow + enforce)', () => {
    applyHarpPatch({ action: 'add-combo', name: 'cr' })
    applyHarpPatch({ action: 'set-combo-match', name: 'cr', match: { task: 'code_review', risk: 'standard' } })
    applyHarpPatch({ action: 'add-combo-step', name: 'cr', step: 'openrouter/deepseek/deepseek-v4-flash' })
    applyHarpPatch({ action: 'add-combo-step', name: 'cr', step: 'openai-codex/gpt-5.5' })
    applyHarpPatch({ action: 'set-combos-global', field: 'enabled', value: true })

    const run = () =>
      JSON.parse(
        execFileSync(
          'python3',
          [SELECTOR, '--task', 'code_review', '--risk', 'standard', '--json'],
          { encoding: 'utf8', env: { ...process.env, HARP_CONFIG_PATH: cfgPath } },
        ),
      ) as Record<string, any>

    const shadow = run()
    expect(shadow.combo_shadow?.name).toBe('cr')
    expect(shadow.combo_shadow?.steps_surviving).toBe(2)
    expect(shadow.decision).not.toBe('combo_enforced')

    applyHarpPatch({ action: 'set-combos-global', field: 'enforce', value: true })
    const enforced = run()
    expect(enforced.decision).toBe('combo_enforced')
    expect(enforced.model).toBe('deepseek/deepseek-v4-flash')
    expect(enforced.routes[0]).toMatchObject({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' })
  })

  it('normalizeCombos in the view drops malformed on-disk entries', () => {
    const raw = YAML.parse(fs.readFileSync(cfgPath, 'utf-8')) as HarpConfig
    raw.combos = {
      enabled: true,
      enforce: false,
      entries: [
        { name: '', steps: ['x/y'] } as never, // blank name → dropped
        { name: 'ok', steps: ['a/b', '', '  c/d  ', 42] } as never, // non-strings/blank dropped+trimmed
      ],
    }
    fs.writeFileSync(cfgPath, YAML.stringify(raw), 'utf-8')
    const combos = getHarpConfigView().combos
    expect(combos.enabled).toBe(true)
    expect(combos.entries).toEqual([{ name: 'ok', steps: ['a/b', 'c/d'] }])
  })
})
