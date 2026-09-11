import { syncGmailNow } from '../src/server/gmail-ingest'
import { listPendingIngestions } from '../src/server/finance-store'

async function main() {
  const before = new Set(listPendingIngestions().map((p) => p.id))
  const result = await syncGmailNow()
  console.log('sync result:', JSON.stringify(result, null, 2))
  const after = listPendingIngestions().filter((p) => !before.has(p.id))
  console.log(`\n${after.length} new pending ingestion(s):\n`)
  for (const p of after) {
    console.log(`- id=${p.id} status=${p.status}`)
    console.log(`  source=${p.source} sourceRef=${p.sourceRef}`)
    if (p.matchedSenderId) console.log(`  matchedSender=${p.matchedSenderLabel} (${p.matchedSenderId})`)
    if (p.passwordHint) console.log(`  passwordHint=${p.passwordHint}`)
    if (p.extracted) console.log(`  extracted=${JSON.stringify(p.extracted)}`)
    if (p.error) console.log(`  error=${p.error}`)
    console.log('')
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('SYNC FAILED:', err)
  process.exit(1)
})
