/**
 * Serves the original uploaded document behind a finance record's
 * `documentRef` — income_source (employment contract), income_record, or
 * expense_record (receipt/bill), all confirmed via the AI intake path. Looks
 * the path up server-side from the record id — never trusts a
 * client-supplied path — and validates the resolved path stays under
 * FINANCE_DATA_DIR, same guard as finance-upload.ts's preview-image GET
 * handler.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { resolveFinanceFilePath } from '../../server/finance-file-security'
import { FINANCE_DATA_DIR, readFinanceStore } from '../../server/finance-store'

function contentTypeFor(filePath: string): string {
  const ext = filePath.toLowerCase()
  if (ext.endsWith('.pdf')) return 'application/pdf'
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

export const Route = createFileRoute('/api/finance-document')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const kind = url.searchParams.get('kind')
        const id = url.searchParams.get('id')
        if (
          !id ||
          (kind !== 'finance_account' &&
            kind !== 'income_source' &&
            kind !== 'income_record' &&
            kind !== 'expense_record' &&
            kind !== 'stock_holding' &&
            kind !== 'fixed_deposit' &&
            kind !== 'tax_record' &&
            kind !== 'insurance_policy')
        ) {
          return json(
            {
              ok: false,
              error:
                'kind=finance_account|income_source|income_record|expense_record|stock_holding|fixed_deposit|tax_record|insurance_policy and id are required.',
            },
            { status: 400 },
          )
        }

        const db = readFinanceStore()
        const record =
          kind === 'finance_account'
            ? db.finance_accounts.find((r) => r.id === id)
            : kind === 'income_source'
              ? db.income_sources.find((r) => r.id === id)
              : kind === 'income_record'
                ? db.income_records.find((r) => r.id === id)
                : kind === 'expense_record'
                  ? db.expense_records.find((r) => r.id === id)
                  : kind === 'stock_holding'
                    ? db.stock_holdings.find((r) => r.id === id)
                    : kind === 'fixed_deposit'
                      ? db.fixed_deposits.find((r) => r.id === id)
                      : kind === 'tax_record'
                        ? db.tax_records.find((r) => r.id === id)
                        : db.insurance_policies.find((r) => r.id === id)
        const documentRef = record?.documentRef
        if (!documentRef)
          return json(
            { ok: false, error: 'No document on file for this record.' },
            { status: 404 },
          )

        const resolved = resolveFinanceFilePath(documentRef, FINANCE_DATA_DIR)
        if (!resolved) {
          return json(
            { ok: false, error: 'Invalid document path.' },
            { status: 400 },
          )
        }
        try {
          const buffer = fs.readFileSync(resolved)
          return new Response(buffer, {
            headers: {
              'content-type': contentTypeFor(resolved),
              'content-disposition': `inline; filename="${path.basename(resolved)}"`,
              'cache-control': 'private, max-age=300',
            },
          })
        } catch {
          return json(
            { ok: false, error: 'Document file not found.' },
            { status: 404 },
          )
        }
      },
    },
  },
})
