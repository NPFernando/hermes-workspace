/**
 * Tests for GET /api/trading/ledger route handler.
 *
 * `isAuthenticated` and `buildLedgerRecordsWithMonitor` are mocked so this
 * stays a fast, network-free unit test of the route's own query-parsing,
 * validation, pagination/filter wiring, and CSV response shape — the
 * normalization logic itself (buildLedgerRecords/queryLedger/renderLedgerCsv)
 * already has its own focused coverage in src/server/trading-ledger.test.ts.
 * `queryLedger`/`renderLedgerCsv` are left un-mocked (real implementations)
 * so this test also exercises the real wiring between the route and that
 * module, not just that the route calls some mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))
vi.mock('../../../server/trading-ledger', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../server/trading-ledger')>()
  return { ...actual, buildLedgerRecordsWithMonitor: vi.fn() }
})

import { isAuthenticated } from '../../../server/auth-middleware'
import type { LedgerRecord } from '../../../server/trading-ledger'
import { buildLedgerRecordsWithMonitor } from '../../../server/trading-ledger'
import { Route } from './ledger'

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockBuildLedgerRecordsWithMonitor = vi.mocked(
  buildLedgerRecordsWithMonitor,
)

function record(overrides: Partial<LedgerRecord>): LedgerRecord {
  return {
    id: 'council:1',
    engine: 'council',
    status: 'closed',
    symbol: 'BTCUSDT',
    strategy: 'sma_crossover',
    executionMode: 'testnet',
    side: 'BUY',
    openedAt: '2026-01-01T00:00:00.000Z',
    closedAt: '2026-01-02T00:00:00.000Z',
    timestamp: '2026-01-02T00:00:00.000Z',
    quantity: 1,
    entryPrice: 100,
    exitPrice: 110,
    entryQuote: 100,
    exitQuote: 110,
    feesQuote: 0.1,
    realizedPnlQuote: 10,
    unrealizedPnlQuote: null,
    sourceId: '1',
    ...overrides,
  }
}

const FIXTURE: Array<LedgerRecord> = [
  record({ id: 'council:1', engine: 'council', symbol: 'BTCUSDT' }),
  record({
    id: 'grid:1',
    engine: 'grid',
    symbol: 'ETHUSDT',
    status: 'open',
    closedAt: null,
    timestamp: '2026-01-03T00:00:00.000Z',
  }),
  record({
    id: 'llm:1',
    engine: 'llm',
    side: 'SELL',
    symbol: 'ADAUSDT',
    timestamp: '2026-01-04T00:00:00.000Z',
    closedAt: '2026-01-04T00:00:00.000Z',
  }),
]

async function callGet(url: string): Promise<Response> {
  const request = new Request(url)
  const route = Route as unknown as {
    options: {
      server?: {
        handlers?: { GET?: (ctx: { request: Request }) => Promise<Response> }
      }
    }
  }
  const handler = route.options.server?.handlers?.GET
  if (!handler) throw new Error('No GET handler')
  return handler({ request })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
  mockBuildLedgerRecordsWithMonitor.mockResolvedValue(FIXTURE)
})

describe('GET /api/trading/ledger — auth', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await callGet('http://localhost/api/trading/ledger')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
    // Never even builds the ledger when unauthenticated.
    expect(mockBuildLedgerRecordsWithMonitor).not.toHaveBeenCalled()
  })
})

describe('GET /api/trading/ledger — validation', () => {
  it.each([
    ['engine', 'not-a-real-engine'],
    ['status', 'pending'],
    ['side', 'HOLD'],
    ['format', 'xml'],
    ['sort', 'random'],
  ])('rejects an invalid %s value with 400', async (key, value) => {
    const res = await callGet(
      `http://localhost/api/trading/ledger?${key}=${value}`,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error.length).toBeGreaterThan(0)
  })
})

describe('GET /api/trading/ledger — JSON response', () => {
  it('returns the full envelope shape with counts/total/hasMore/asOf', async () => {
    const res = await callGet('http://localhost/api/trading/ledger')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      records: Array<LedgerRecord>
      total: number
      page: number
      pageSize: number
      hasMore: boolean
      asOf: string
      counts: Record<string, number>
    }
    expect(body.ok).toBe(true)
    expect(body.records).toHaveLength(3)
    expect(body.total).toBe(3)
    expect(body.page).toBe(1)
    expect(body.hasMore).toBe(false)
    expect(typeof body.asOf).toBe('string')
    expect(body.counts).toEqual({ council: 1, grid: 1, llm: 1, rebalance: 0 })
  })

  it('filters by engine and side via query params', async () => {
    const res = await callGet(
      'http://localhost/api/trading/ledger?engine=llm&side=SELL',
    )
    const body = (await res.json()) as { records: Array<LedgerRecord> }
    expect(body.records).toHaveLength(1)
    expect(body.records[0].id).toBe('llm:1')
  })

  it('bounds pageSize and paginates', async () => {
    const res = await callGet(
      'http://localhost/api/trading/ledger?pageSize=1&page=2',
    )
    const body = (await res.json()) as {
      records: Array<LedgerRecord>
      pageSize: number
      hasMore: boolean
      total: number
    }
    expect(body.pageSize).toBe(1)
    expect(body.records).toHaveLength(1)
    expect(body.total).toBe(3)
    expect(body.hasMore).toBe(true)
  })

  it('sorts most-recent-first by default', async () => {
    const res = await callGet('http://localhost/api/trading/ledger')
    const body = (await res.json()) as { records: Array<LedgerRecord> }
    expect(body.records.map((r) => r.id)).toEqual(['llm:1', 'grid:1', 'council:1'])
  })
})

describe('GET /api/trading/ledger — CSV format', () => {
  it('returns safely escaped, bounded CSV with a text/csv content type', async () => {
    const res = await callGet(
      'http://localhost/api/trading/ledger?format=csv&pageSize=2',
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    const text = await res.text()
    const lines = text.trim().split('\r\n')
    // Header + exactly pageSize (2) data rows — bounded, not the full set.
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^id,engine,status,symbol/)
  })
})
