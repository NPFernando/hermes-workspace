import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { decryptFinanceBackup, encryptFinanceBackup, verifyFinanceBackup } from '../../server/finance-backup'
import { readFinanceStore, writeFinanceStore } from '../../server/finance-store'
import { financeRestorePlan } from '../../server/finance-restore-policy'

type BackupRequest = {
  action?: 'export' | 'restore' | 'verify'
  passphrase?: string
  backup?: unknown
  mode?: 'preview' | 'apply'
  confirmation?: string
}

export const Route = createFileRoute('/api/finance-backup')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        const body = (await request.json().catch(() => ({}))) as BackupRequest
        if (typeof body.passphrase !== 'string') return json({ ok: false, error: 'A passphrase is required.' }, { status: 400 })
        try {
          if (body.action === 'export') {
            return json({ ok: true, backup: encryptFinanceBackup(readFinanceStore(), body.passphrase) })
          }
          if (body.action === 'verify') {
            return json({ ok: true, verification: verifyFinanceBackup(body.backup, body.passphrase) })
          }
          if (body.action === 'restore') {
            const restored = decryptFinanceBackup(body.backup, body.passphrase)
            const verification = verifyFinanceBackup(body.backup, body.passphrase)
            const plan = financeRestorePlan({ mode: body.mode, confirmation: body.confirmation })
            if (!plan.apply) {
              return json({
                ok: true,
                preview: true,
                restored: false,
                schemaVersion: restored.schemaVersion,
                verification,
                requiredConfirmation: plan.requiredConfirmation,
              })
            }
            writeFinanceStore(restored)
            return json({ ok: true, preview: false, restored: true, schemaVersion: restored.schemaVersion, verification })
          }
          return json({ ok: false, error: 'Unsupported backup action.' }, { status: 400 })
        } catch (error) {
          return json({ ok: false, error: error instanceof Error ? error.message : 'Finance backup failed.' }, { status: 400 })
        }
      },
    },
  },
})
