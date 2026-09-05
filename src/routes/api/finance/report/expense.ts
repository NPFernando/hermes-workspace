import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../../server/auth-middleware'
import { readFinanceStore } from '../../../../server/finance-store'
import type { ExpenseRecord } from '../../../../server/finance-store'

export const Route = createFileRoute('/api/finance/report/expense')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const startDateStr = url.searchParams.get('startDate')
        const endDateStr = url.searchParams.get('endDate')

        if (!startDateStr || !endDateStr) {
          return json(
            {
              ok: false,
              error: 'startDate and endDate query parameters are required',
            },
            { status: 400 },
          )
        }

        const startDate = new Date(startDateStr)
        const endDate = new Date(endDateStr)

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return json(
            {
              ok: false,
              error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)',
            },
            { status: 400 },
          )
        }

        if (startDate > endDate) {
          return json(
            {
              ok: false,
              error: 'startDate must be before or equal to endDate',
            },
            { status: 400 },
          )
        }

        const db = readFinanceStore()
        const filteredExpense = db.expense_records.filter(
          (record: ExpenseRecord) => {
            const recordDate = new Date(record.date)
            return recordDate >= startDate && recordDate <= endDate
          },
        )

        return json({
          ok: true,
          fetchedAt: Date.now(),
          startDate: startDateStr,
          endDate: endDateStr,
          count: filteredExpense.length,
          expense_records: filteredExpense,
        })
      },
    },
  },
})
