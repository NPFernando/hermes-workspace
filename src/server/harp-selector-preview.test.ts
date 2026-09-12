import { describe, expect, it, vi } from 'vitest'
import {
  loadHarpSelectorPreview,
  parseHarpSelectorPreview,
} from './harp-selector-preview'

function previewFixture() {
  return {
    tasks: ['code_generation', 'code_review'],
    risks: ['standard', 'high_risk'],
    generated_at: '2026-09-12T00:00:00Z',
    matrix: ['standard', 'high_risk'].map((risk) => ({
      risk,
      cells: ['code_generation', 'code_review'].map(() => ({
        available: true,
        provider: 'openai-codex',
        model: 'gpt-5.5',
        tier: 'subscription',
        decision: 'phase_enforced',
        reason: 'subscription-first',
      })),
    })),
  }
}

describe('HARP selector preview', () => {
  it('accepts a complete matrix and rejects incomplete or mismatched matrices', () => {
    const fixture = previewFixture()
    expect(parseHarpSelectorPreview(fixture)).toEqual(fixture)
    expect(
      parseHarpSelectorPreview({
        ...fixture,
        matrix: [{ risk: 'standard', cells: [] }],
      }),
    ).toBeNull()
  })

  it('uses only the local fixed preview endpoint with no-store and a bounded timeout', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json(previewFixture())),
    )
    const result = await loadHarpSelectorPreview(fetcher)

    expect(result.matrix).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:5052/api/harp/selector-preview',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('rejects non-success and malformed upstream responses', async () => {
    await expect(
      loadHarpSelectorPreview(() =>
        Promise.resolve(new Response('{}', { status: 503 })),
      ),
    ).rejects.toThrow(/unavailable/i)
    await expect(
      loadHarpSelectorPreview(() =>
        Promise.resolve(Response.json({ matrix: [] })),
      ),
    ).rejects.toThrow(/invalid matrix/i)
  })
})
