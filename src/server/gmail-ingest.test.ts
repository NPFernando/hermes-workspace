import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnownSender } from './finance-store'

function sender(overrides: Partial<KnownSender> = {}): KnownSender {
  return {
    id: 'sender-1',
    label: 'Example Bank',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildSearchQuery / matchKnownSender (pure helpers)', () => {
  it('falls back to the keyword group alone when there are no known senders', async () => {
    const { buildSearchQuery } = await import('./gmail-ingest')
    const query = buildSearchQuery([], 1700000000)
    expect(query).toContain('invoice OR receipt')
    expect(query).toContain('after:1700000000')
    expect(query).not.toContain('from:')
  })

  it('OR-combines the keyword group with from: clauses built from matchAddress/matchDomain', async () => {
    const { buildSearchQuery } = await import('./gmail-ingest')
    const query = buildSearchQuery(
      [
        sender({ matchAddress: 'e-statement@example-bank.test' }),
        sender({ id: 'sender-2', matchDomain: 'example-utility.test' }),
        sender({ id: 'sender-3' }), // neither field set — contributes nothing
      ],
      1700000000,
    )
    expect(query).toContain('from:e-statement@example-bank.test')
    expect(query).toContain('from:example-utility.test')
    expect(query).toMatch(/OR/)
  })

  it('matchKnownSender matches on address substring, case-insensitively', async () => {
    const { matchKnownSender } = await import('./gmail-ingest')
    const known = [sender({ matchAddress: 'e-statement@example-bank.test' })]
    expect(
      matchKnownSender('"Example Bank" <E-Statement@Example-Bank.test>', known),
    ).toEqual(known[0])
    expect(matchKnownSender('someone@else.test', known)).toBeUndefined()
  })

  it('matchKnownSender falls back to domain match when no address is set', async () => {
    const { matchKnownSender } = await import('./gmail-ingest')
    const known = [sender({ matchDomain: 'example-utility.test' })]
    expect(
      matchKnownSender('billing@sub.example-utility.test', known),
    ).toEqual(known[0])
  })
})

describe('syncGmailNow', () => {
  const accessToken = 'test-access-token'
  let pendingIngestions: Array<Record<string, unknown>>

  beforeEach(() => {
    vi.resetModules()
    pendingIngestions = []
    vi.doMock('./google-oauth', () => ({
      getGmailAccessToken: vi.fn(async () => accessToken),
    }))
    vi.doMock('./finance-store', () => ({
      FINANCE_INGESTION_UPLOAD_DIR: '/tmp/gmail-ingest-test-uploads',
      readFinanceStore: vi.fn(() => ({ settings: {} })),
      writeFinanceStore: vi.fn(),
      getCategoryCorrections: vi.fn(() => ({})),
      listPendingIngestions: vi.fn(() => pendingIngestions),
      addPendingIngestion: vi.fn((input: Record<string, unknown>) => {
        const record = { id: `pending-${pendingIngestions.length}`, ...input }
        pendingIngestions.push(record)
        return record
      }),
      listKnownSenders: vi.fn(() => [] as Array<KnownSender>),
      decryptKnownSenderPassword: vi.fn(() => undefined),
    }))
    vi.doMock('./document-normalizer', () => ({
      isPdfEncrypted: vi.fn(() => false),
      pdfToImages: vi.fn(() => ({ ok: true, imagePaths: ['/tmp/preview.png'] })),
    }))
    vi.doMock('./finance-extraction', () => ({
      extractTransactionFromText: vi.fn(async () => ({ ok: false as const })),
      extractTransactionFromImage: vi.fn(async () => ({ ok: false as const })),
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/messages?')) {
          return {
            ok: true,
            json: async () => ({ messages: [], nextPageToken: undefined }),
          } as Response
        }
        throw new Error(`Unexpected fetch in this test: ${url}`)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./google-oauth')
    vi.doUnmock('./finance-store')
    vi.doUnmock('./document-normalizer')
    vi.doUnmock('./finance-extraction')
  })

  it('returns zero found/queued when Gmail has no matching messages', async () => {
    const { syncGmailNow } = await import('./gmail-ingest')
    const result = await syncGmailNow()
    expect(result).toEqual({ found: 0, queued: 0, skippedAlreadyQueued: 0 })
  })

  it('paginates across multiple pages via nextPageToken and stops once a page has none', async () => {
    const seenUrls: Array<string> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seenUrls.push(url)
        if (url.includes('pageToken=page-2')) {
          return {
            ok: true,
            json: async () => ({ messages: [{ id: 'm3' }] }),
          } as Response
        }
        if (url.includes('/messages?')) {
          return {
            ok: true,
            json: async () => ({
              messages: [{ id: 'm1' }, { id: 'm2' }],
              nextPageToken: 'page-2',
            }),
          } as Response
        }
        // Individual message fetch — no attachments, no plain-text body,
        // extraction disabled above, so each is skipped quietly.
        return { ok: true, json: async () => ({ id: 'x', payload: {} }) } as Response
      }),
    )
    const { syncGmailNow } = await import('./gmail-ingest')
    const result = await syncGmailNow()
    expect(result.found).toBe(3)
    expect(seenUrls.some((u) => u.includes('pageToken=page-2'))).toBe(true)
  })

  it('auto-unlocks an encrypted PDF from a known sender with a stored password, skipping awaiting_password', async () => {
    const known = sender({
      matchAddress: 'e-statement@example-bank.test',
      passwordScheme: 'date of birth, DDMMYYYY',
    })
    vi.doMock('./finance-store', () => ({
      FINANCE_INGESTION_UPLOAD_DIR: '/tmp/gmail-ingest-test-uploads',
      readFinanceStore: vi.fn(() => ({ settings: {} })),
      writeFinanceStore: vi.fn(),
      getCategoryCorrections: vi.fn(() => ({})),
      listPendingIngestions: vi.fn(() => pendingIngestions),
      addPendingIngestion: vi.fn((input: Record<string, unknown>) => {
        const record = { id: `pending-${pendingIngestions.length}`, ...input }
        pendingIngestions.push(record)
        return record
      }),
      listKnownSenders: vi.fn(() => [known]),
      decryptKnownSenderPassword: vi.fn(() => 'the-real-password'),
    }))
    vi.doMock('./document-normalizer', () => ({
      isPdfEncrypted: vi.fn(() => true),
      pdfToImages: vi.fn((_path: string, password?: string) =>
        password === 'the-real-password'
          ? { ok: true, imagePaths: ['/tmp/preview.png'] }
          : { ok: false, reason: 'bad_password' },
      ),
    }))
    vi.doMock('./finance-extraction', () => ({
      extractTransactionFromText: vi.fn(async () => ({ ok: false as const })),
      extractTransactionFromImage: vi.fn(async () => ({
        ok: true as const,
        data: {
          kind: 'expense' as const,
          amount: 100,
          currency: 'LKR',
          vendorOrSource: 'Example Bank',
          date: '2026-01-01',
          confidence: 'high' as const,
        },
      })),
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/messages?'))
          return { ok: true, json: async () => ({ messages: [{ id: 'm1' }] }) } as Response
        if (url.includes('/messages/m1?'))
          return {
            ok: true,
            json: async () => ({
              id: 'm1',
              payload: {
                headers: [
                  { name: 'From', value: '"Example Bank" <e-statement@example-bank.test>' },
                ],
                mimeType: 'multipart/mixed',
                parts: [
                  {
                    filename: 'statement.pdf',
                    mimeType: 'application/pdf',
                    body: { attachmentId: 'att1', size: 100 },
                  },
                ],
              },
            }),
          } as Response
        if (url.includes('/attachments/att1'))
          return { ok: true, json: async () => ({ data: 'aGVsbG8=' }) } as Response
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )
    // downloadAttachment writes to disk — give it a real (test-only) writable dir.
    const os = await import('node:os')
    const path = await import('node:path')
    const fs = await import('node:fs')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-ingest-'))
    vi.doMock('./finance-store', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./finance-store')>()
      return {
        ...actual,
        FINANCE_INGESTION_UPLOAD_DIR: tmp,
        readFinanceStore: vi.fn(() => ({ settings: {} })),
        writeFinanceStore: vi.fn(),
        getCategoryCorrections: vi.fn(() => ({})),
        listPendingIngestions: vi.fn(() => pendingIngestions),
        addPendingIngestion: vi.fn((input: Record<string, unknown>) => {
          const record = { id: `pending-${pendingIngestions.length}`, ...input }
          pendingIngestions.push(record)
          return record
        }),
        listKnownSenders: vi.fn(() => [known]),
        decryptKnownSenderPassword: vi.fn(() => 'the-real-password'),
      }
    })

    const { syncGmailNow } = await import('./gmail-ingest')
    const result = await syncGmailNow()

    expect(result.queued).toBe(1)
    expect(pendingIngestions).toHaveLength(1)
    expect(pendingIngestions[0].status).toBe('awaiting_review')
    expect(pendingIngestions[0].matchedSenderId).toBe(known.id)
    expect(pendingIngestions[0].matchedSenderLabel).toBe('Example Bank')

    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
