import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getHarpObservabilityView } from './harp-observability'

let tmpDir = ''
let routingLog = ''
let comboLog = ''
const originalEnv: Record<string, string | undefined> = {}

function setEnv(key: string, value: string | undefined) {
  if (!(key in originalEnv)) originalEnv[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const SELECTED_ROW = JSON.stringify({
  at: '2026-09-09T10:00:00+00:00',
  status: 'selected',
  task: 'code_generation',
  risk: 'standard',
  provider: 'openai-codex',
  model: 'gpt-5.5',
  tier: 'subscription',
  fallback_count: 0,
})
const BLOCKED_ROW = JSON.stringify({
  at: '2026-09-09T11:00:00+00:00',
  status: 'policy_blocked',
  task: 'production_risk',
  risk: 'production',
  reason: 'verified_lane_required',
})
const COMBO_ROW = JSON.stringify({
  ts: '2026-09-09T12:00:00+00:00',
  task: 'code_review',
  risk: 'standard',
  combo: 'cheap-code-review',
  applied: false,
  decision: 'phase_enforced',
  combo_would_select: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
  actual: { provider: 'openai-codex', model: 'gpt-5.5' },
  steps_surviving: 3,
  steps_filtered: [],
})

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harp-obs-'))
  routingLog = path.join(tmpDir, 'harp-routing.jsonl')
  comboLog = path.join(tmpDir, 'harp-combo-shadow.log')
  setEnv('HARP_ROUTING_LOG_PATH', routingLog)
  setEnv('HARP_COMBO_SHADOW_LOG_PATH', comboLog)
})

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const k of Object.keys(originalEnv)) delete originalEnv[k]
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('getHarpObservabilityView', () => {
  it('returns empty, well-formed data when no log files exist', () => {
    const view = getHarpObservabilityView()
    expect(view.routingLogExists).toBe(false)
    expect(view.comboShadowLogExists).toBe(false)
    expect(view.decisions).toEqual([])
    expect(view.comboShadow).toEqual([])
    expect(view.decisionSummary.total).toBe(0)
    expect(view.decisionSummary.windowFrom).toBeNull()
    expect(view.routingLogPath).toBe(routingLog)
  })

  it('parses both routing-decision row shapes, newest first', () => {
    fs.writeFileSync(routingLog, `${SELECTED_ROW}\n${BLOCKED_ROW}\n`)
    const view = getHarpObservabilityView()
    expect(view.routingLogExists).toBe(true)
    expect(view.decisions).toHaveLength(2)
    // newest (11:00 blocked) first
    expect(view.decisions[0].status).toBe('policy_blocked')
    expect(view.decisions[0].reason).toBe('verified_lane_required')
    expect(view.decisions[0].model).toBeUndefined()
    expect(view.decisions[1].status).toBe('selected')
    expect(view.decisions[1].model).toBe('gpt-5.5')
    expect(view.decisions[1].fallbackCount).toBe(0)
    expect(view.decisionSummary).toMatchObject({
      total: 2,
      selected: 1,
      policyBlocked: 1,
      windowFrom: '2026-09-09T10:00:00+00:00',
      windowTo: '2026-09-09T11:00:00+00:00',
    })
  })

  it('skips torn / non-JSON lines instead of throwing', () => {
    fs.writeFileSync(routingLog, `${SELECTED_ROW}\n{"at":"broken`)
    const view = getHarpObservabilityView()
    expect(view.decisions).toHaveLength(1)
    expect(view.decisions[0].model).toBe('gpt-5.5')
  })

  it('normalises combo-shadow rows and collapses steps_filtered to a count', () => {
    fs.writeFileSync(comboLog, `${COMBO_ROW}\n`)
    const view = getHarpObservabilityView()
    expect(view.comboShadow).toHaveLength(1)
    const c = view.comboShadow[0]
    expect(c.combo).toBe('cheap-code-review')
    expect(c.applied).toBe(false)
    expect(c.decision).toBe('phase_enforced')
    expect(c.comboWouldSelect).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    })
    expect(c.actual).toEqual({ provider: 'openai-codex', model: 'gpt-5.5' })
    expect(c.stepsFiltered).toBe(0)
    expect(c.stepsSurviving).toBe(3)
  })

  it('caps the routing-decision tail', () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      JSON.stringify({
        at: `2026-09-09T${String(i % 24).padStart(2, '0')}:00:00+00:00`,
        status: 'selected',
        task: 'debugging',
        risk: 'standard',
        provider: 'openai-codex',
        model: 'gpt-5.5',
      }),
    )
    fs.writeFileSync(routingLog, `${rows.join('\n')}\n`)
    const view = getHarpObservabilityView()
    expect(view.decisions.length).toBeLessThanOrEqual(40)
  })

  it('always reports a discovery block with a source field', () => {
    const view = getHarpObservabilityView()
    expect(['postgres', 'none']).toContain(view.discovery.source)
  })
})
