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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
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
const apiKey = mergedEnv.BINANCE_API_KEY
const apiSecret = mergedEnv.BINANCE_API_SECRET
const baseUrl = (mergedEnv.BINANCE_BASE_URL || 'https://api.binance.com').replace(/\/$/, '')
const liveReadApproval = mergedEnv.BINANCE_ALLOW_LIVE_ACCOUNT_READ === 'I_APPROVE_LIVE_ACCOUNT_READ'

if (!apiKey || !apiSecret) {
  console.error('Missing production Binance credentials. Add BINANCE_API_KEY and BINANCE_API_SECRET to hermes-workspace/.env for a live read-only account check.')
  process.exit(2)
}

if (!liveReadApproval) {
  console.error('Refusing live Binance account access without BINANCE_ALLOW_LIVE_ACCOUNT_READ=I_APPROVE_LIVE_ACCOUNT_READ. This script is read-only but still touches the production account API.')
  process.exit(2)
}

if (baseUrl.includes('testnet')) {
  console.error('Refusing testnet URL in live read-only smoke script. Use scripts/binance-testnet-smoke.mjs for testnet/demo keys.')
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${redact(typeof body === 'string' ? body : JSON.stringify(body))}`)
  return body
}

function signedParams(secret) {
  const params = new URLSearchParams({ timestamp: Date.now().toString(), recvWindow: '5000' })
  const signature = createHmac('sha256', secret).update(params.toString()).digest('hex')
  params.set('signature', signature)
  return params
}

async function main() {
  await requestJson(`${baseUrl}/api/v3/ping`)
  const apiRestrictions = await requestJson(`${baseUrl}/sapi/v1/account/apiRestrictions?${signedParams(apiSecret).toString()}`, { headers: { 'X-MBX-APIKEY': apiKey } })
  const unsafeFlags = [
    'enableWithdrawals',
    'enableInternalTransfer',
    'permitsUniversalTransfer',
    'enableMargin',
    'enableFutures',
    'enablePortfolioMarginTrading',
    'enableFixApiTrade',
    'enableSpotAndMarginTrading',
  ].filter((field) => apiRestrictions?.[field] === true)
  if (unsafeFlags.length > 0) {
    throw new Error(`Unsafe Binance API key permissions: ${unsafeFlags.join(', ')}. For this phase keep only Reading enabled; spot trading can be added later after Hermes approval/risk controls are enabled.`)
  }
  const account = await requestJson(`${baseUrl}/api/v3/account?${signedParams(apiSecret).toString()}`, { headers: { 'X-MBX-APIKEY': apiKey } })
  const balances = Array.isArray(account?.balances) ? account.balances : []
  const assetsWithNonZeroBalance = balances
    .filter((item) => Number(item.free) > 0 || Number(item.locked) > 0)
    .slice(0, 10)
    .map((item) => item.asset)
  console.log(JSON.stringify({
    ok: true,
    mode: 'production-readonly-account-smoke',
    baseUrl,
    canPing: true,
    canReadAccount: true,
    accountType: account?.accountType ?? null,
    permissions: account?.permissions ?? [],
    canTrade: account?.canTrade ?? null,
    canWithdraw: account?.canWithdraw ?? null,
    canDeposit: account?.canDeposit ?? null,
    apiKeyPermissions: {
      ipRestrict: apiRestrictions?.ipRestrict ?? null,
      tradingEnabled: apiRestrictions?.enableSpotAndMarginTrading ?? null,
      withdrawalsEnabled: apiRestrictions?.enableWithdrawals ?? null,
      marginEnabled: apiRestrictions?.enableMargin ?? null,
      futuresEnabled: apiRestrictions?.enableFutures ?? null,
      universalTransferEnabled: apiRestrictions?.permitsUniversalTransfer ?? null,
    },
    nonZeroBalanceCount: assetsWithNonZeroBalance.length,
    assetsWithNonZeroBalance,
  }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: redact(error?.message || error) }, null, 2))
  process.exit(1)
})
