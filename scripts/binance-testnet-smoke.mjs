#!/usr/bin/env node
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const env = {}
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[match[1]] = value
  }
  return env
}

function redact(text) {
  return String(text)
    .replace(/[A-Za-z0-9_\-]{32,}/g, '[REDACTED]')
    .slice(0, 1200)
}

const envFromFile = parseEnvFile(resolve(process.cwd(), '.env'))
const mergedEnv = { ...envFromFile, ...process.env }
const usesTestnetCredentials = Boolean(
  mergedEnv.BINANCE_TESTNET_API_KEY && mergedEnv.BINANCE_TESTNET_API_SECRET,
)
const apiKey = mergedEnv.BINANCE_TESTNET_API_KEY
const apiSecret = mergedEnv.BINANCE_TESTNET_API_SECRET
const baseUrl = (
  mergedEnv.BINANCE_TESTNET_BASE_URL || 'https://testnet.binance.vision'
).replace(/\/$/, '')
const isTestnetUrl = baseUrl.includes('testnet.binance.vision')
const liveReadApproval =
  mergedEnv.BINANCE_ALLOW_LIVE_ACCOUNT_READ === 'I_APPROVE_LIVE_ACCOUNT_READ'

if (!apiKey || !apiSecret) {
  console.error(
    'Missing Binance testnet credentials. Add BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET to hermes-workspace/.env, then restart hermes-workspace.service. Production BINANCE_API_KEY/BINANCE_API_SECRET are intentionally ignored by this smoke test.',
  )
  process.exit(2)
}

if (!usesTestnetCredentials) {
  console.error(
    'Refusing to use production Binance key variables in the testnet smoke script. Use BINANCE_TESTNET_API_KEY/BINANCE_TESTNET_API_SECRET for demo tests.',
  )
  process.exit(2)
}

if (!isTestnetUrl && !liveReadApproval) {
  console.error(
    'Refusing to contact a non-testnet Binance URL. Set BINANCE_ALLOW_LIVE_ACCOUNT_READ=I_APPROVE_LIVE_ACCOUNT_READ only for an intentional read-only production account check.',
  )
  process.exit(2)
}

async function requestJson(url, init = {}) {
  const res = await fetch(url, init)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}: ${redact(typeof body === 'string' ? body : JSON.stringify(body))}`,
    )
  }
  return body
}

async function main() {
  await requestJson(`${baseUrl}/api/v3/ping`)
  const params = new URLSearchParams({
    timestamp: Date.now().toString(),
    recvWindow: '5000',
  })
  const signature = createHmac('sha256', apiSecret)
    .update(params.toString())
    .digest('hex')
  params.set('signature', signature)
  const account = await requestJson(
    `${baseUrl}/api/v3/account?${params.toString()}`,
    {
      headers: { 'X-MBX-APIKEY': apiKey },
    },
  )
  const balances = Array.isArray(account?.balances) ? account.balances : []
  const nonZeroBalances = balances
    .filter((item) => Number(item.free) > 0 || Number(item.locked) > 0)
    .slice(0, 10)
    .map((item) => ({
      asset: item.asset,
      free: item.free,
      locked: item.locked,
    }))
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'spot-testnet-readonly-smoke',
        baseUrl,
        canPing: true,
        canReadAccount: true,
        accountType: account?.accountType ?? null,
        permissions: account?.permissions ?? [],
        nonZeroBalanceCount: nonZeroBalances.length,
        nonZeroBalances,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      { ok: false, error: redact(error?.message || error) },
      null,
      2,
    ),
  )
  process.exit(1)
})
