import * as https from 'node:https';
import { randomUUID } from 'node:crypto';
import { appendAuditLog, ensureFinanceStore, writeFinanceStore } from './finance-store';
import type { FinanceDatabase } from './finance-store';

// Binance API endpoints for market data (using data-api.binance.vision to avoid rate limits on the main API)
const BINANCE_SPOT_API = 'https://data-api.binance.vision';

// Outbound-request guards so a hung/oversized upstream can never hang or OOM the API handler.
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * GETs a URL and returns the parsed JSON body, bounded by a hard timeout and a
 * maximum response size. Rejects (aborting the socket) on timeout, oversized
 * body, network error, or invalid JSON.
 */
function httpsGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Binance response exceeded maximum allowed size'));
          return;
        }
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (err) {
          reject(new Error(`Failed to parse Binance response: ${err}`));
        }
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Binance request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on('error', (err) => {
      reject(new Error(`Failed to fetch from Binance: ${err}`));
    });
  });
}

// Types for Binance API responses
interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

/**
 * Fetches the latest ticker price for a symbol from Binance
 */
export async function fetchBinanceTickerPrice(symbol: string): Promise<{ price: number; bid?: number; ask?: number }> {
  const url = `${BINANCE_SPOT_API}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const parsed = await httpsGetJson<BinanceTickerPrice>(url);
  // The ticker/price endpoint doesn't provide bid/ask, we leave them undefined.
  return { price: parseFloat(parsed.price) };
}

/**
 * Fetches historical klines (OHLCV) for a symbol and interval from Binance
 * @param symbol Trading pair symbol (e.g., BTCUSDT)
 * @param interval Kline interval (e.g., 1h, 1d, 15m)
 * @param limit Number of klines to retrieve (max 1000)
 */
export async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit: number = 500
): Promise<Array<{
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}>> {
  const cappedLimit = Math.max(1, Math.min(limit, 1000));
  const url = `${BINANCE_SPOT_API}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${cappedLimit}`;
  const parsed = await httpsGetJson<Array<Array<unknown>>>(url);
  return parsed.map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
    closeTime: Number(k[6]),
  }));
}

/**
 * Adds a market price record to the finance store
 */
export function addMarketPrice(
  symbol: string,
  price: number,
  bid: number | undefined,
  ask: number | undefined,
  volume: number | undefined,
  platform: string = 'binance',
  source: string = 'binance-public-api'
): FinanceDatabase {
  const db = ensureFinanceStore();
  const marketPrice = {
    id: randomUUID(),
    platform,
    symbol,
    price,
    bid,
    ask,
    spread: bid && ask ? ask - bid : undefined,
    volume,
    currency: 'USDT', // Assuming USDT quote currency for now, could be made configurable
    observedAt: new Date().toISOString(),
    source,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.market_prices.push(marketPrice);
  writeFinanceStore(db);
  appendAuditLog('market_price_added', { symbol, price, platform });
  return db;
}

/**
 * Persists a batch of historical candles to the finance store in a single write.
 * Batching avoids re-serializing the whole store once per candle.
 */
export function addBinanceCandles(
  symbol: string,
  interval: string,
  candles: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    openTime: number;
    closeTime: number;
  }>,
  platform: string = 'binance',
  source: string = 'binance-public-api'
): FinanceDatabase {
  const db = ensureFinanceStore();
  const now = new Date().toISOString();
  for (const c of candles) {
    db.historical_candles.push({
      id: randomUUID(),
      platform,
      symbol,
      interval,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      openedAt: new Date(c.openTime).toISOString(),
      closedAt: new Date(c.closeTime).toISOString(),
      source,
      createdAt: now,
      updatedAt: now,
    });
  }
  writeFinanceStore(db);
  appendAuditLog('historical_candles_added', { symbol, interval, count: candles.length, platform });
  return db;
}