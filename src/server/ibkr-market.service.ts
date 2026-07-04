import { randomUUID } from 'node:crypto';
import { appendAuditLog, ensureFinanceStore, writeFinanceStore } from './finance-store';
import type { FinanceDatabase } from './finance-store';

// NOTE: This connector produces *simulated* IBKR paper-trading data. There are no
// real credentials or network calls here; it exists so the store/UI can be wired
// and exercised before a real IBKR integration is added.

/**
 * Maximum number of bars per request (simulating IBKR limit)
 */
const MAX_BARS_PER_REQUEST = 1000;

/**
 * Parses an interval string (e.g., '1 min', '5 mins', '1 h', '1 d') into milliseconds.
 * @param interval Interval string (e.g., '1 min', '5 mins', '1 h', '1 d', '1 w', '1 m')
 * @returns Interval in milliseconds
 */
export function parseIntervalToMs(interval: string): number {
  const trimmed = interval.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|m|month|months)?$/);
  if (!match) {
    // Default to 1 minute if unrecognized
    return 60 * 1000;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2] || 'min'; // default to minutes if no unit provided

  switch (unit) {
    case 'min':
    case 'mins':
    case 'minute':
    case 'minutes':
      return value * 60 * 1000;
    case 'h':
    case 'hr':
    case 'hrs':
    case 'hour':
    case 'hours':
      return value * 60 * 60 * 1000;
    case 'd':
    case 'day':
    case 'days':
      return value * 24 * 60 * 60 * 1000;
    case 'w':
    case 'week':
    case 'weeks':
      return value * 7 * 24 * 60 * 60 * 1000;
    case 'm':
    case 'month':
    case 'months':
      // Approximate a month as 30 days
      return value * 30 * 24 * 60 * 60 * 1000;
    default:
      return value * 60 * 1000; // default to minutes
  }
}

/**
 * Returns the maximum lookback time in milliseconds for IBKR historical data based on bar size.
 * This is the effective limit considering both time-based constraints and max bars per request.
 * @param interval Interval string (e.g., '1 min', '1 day')
 * @returns Maximum lookback time in milliseconds
 */
export function getMaxLookbackMs(interval: string): number {
  const intervalMs = parseIntervalToMs(interval);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * oneDayMs;
  const threeSixtyFiveDaysMs = 365 * oneDayMs;

  // Time-based limits (simulating IBKR restrictions)
  let timeBasedLookbackMs: number;
  if (intervalMs >= oneDayMs) {
    // For bar sizes >= 1 day, IBKR allows up to 20 years
    timeBasedLookbackMs = 20 * threeSixtyFiveDaysMs;
  } else {
    // For bar sizes < 1 day, IBKR allows up to 60 days
    timeBasedLookbackMs = 60 * oneDayMs;
  }

  // Bar count limit: max bars per request multiplied by interval size
  const barCountBasedLookbackMs = MAX_BARS_PER_REQUEST * intervalMs;

  // The effective lookback is the minimum of the two limits
  return Math.min(timeBasedLookbackMs, barCountBasedLookbackMs);
}

/**
 * Fetches the latest ticker price for a symbol from IBKR paper trading (simulated)
 * @param symbol Trading pair symbol (e.g., AAPL, ES)
 * @returns Promise with price, bid, ask
 */
export async function fetchIBKRTicker(symbol: string): Promise<{ price: number; bid: number; ask: number }> {
  // Simulate API call - in real implementation, this would call IBKR API
  return new Promise((resolve, reject) => {
    // Simulate network delay
    setTimeout(() => {
      // Generate mock data based on symbol hash for consistency
      const hash = Array.from(symbol).reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const basePrice = 100 + (hash % 900); // Price between 100 and 1000
      const spread = 0.01 * basePrice; // 1% spread
      const price = basePrice + (Math.random() - 0.5) * spread * 0.2; // Small random movement
      const bid = price - spread / 2;
      const ask = price + spread / 2;
      const volume = 1000 + (hash % 9000); // Random volume

      resolve({
        price: parseFloat(price.toFixed(2)),
        bid: parseFloat(bid.toFixed(2)),
        ask: parseFloat(ask.toFixed(2)),
        // Note: volume is not returned by ticker in real IBKR, but we'll include for completeness
        // We'll handle volume separately in bar data
      });
    }, 100 + Math.random() * 200); // Simulate network latency
  });
}

/**
 * Fetches historical bars (OHLCV) for a symbol and interval from IBKR (simulated)
 * @param symbol Trading pair symbol
 * @param interval Bar size (e.g., '1 min', '5 mins', '1 day')
 * @param count Number of bars to retrieve (max depends on IBKR limits)
 * @param endTime Optional end time (milliseconds since epoch or ISO string). If not provided, uses now.
 * @returns Promise with array of bars in chronological order (oldest first)
 */
export async function getIBKRCandles(
  symbol: string,
  interval: string,
  count: number = 100,
  endTime?: number | string
): Promise<Array<{
  time: number; // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        // Determine end time
        let endTimeMs: number;
        if (endTime !== undefined) {
          if (typeof endTime === 'string') {
            endTimeMs = Date.parse(endTime);
            if (isNaN(endTimeMs)) {
              throw new Error(`Invalid endTime string: ${endTime}`);
            }
          } else {
            endTimeMs = endTime;
          }
        } else {
          endTimeMs = Date.now();
        }

        const bars: Array<{
          time: number;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }> = [];

        // Determine interval in milliseconds
        const intervalMs = parseIntervalToMs(interval);

        // Generate bars going back from endTimeMs
        for (let i = 0; i < count; i++) {
          const barTime = endTimeMs - i * intervalMs;
          const hash = Array.from(symbol).reduce((acc, char) => acc + char.charCodeAt(0), 0) + i;
          const basePrice = 100 + (hash % 900);
          const volatility = 0.02 * basePrice; // 2% volatility
          const open = basePrice + (Math.random() - 0.5) * volatility;
          const close = basePrice + (Math.random() - 0.5) * volatility;
          const high = Math.max(open, close) + Math.random() * volatility / 2;
          const low = Math.min(open, close) - Math.random() * volatility / 2;
          const volume = 1000 + (hash % 9000) + Math.random() * 5000;

          bars.push({
            time: barTime,
            open: parseFloat(open.toFixed(2)),
            high: parseFloat(high.toFixed(2)),
            low: parseFloat(low.toFixed(2)),
            close: parseFloat(close.toFixed(2)),
            volume: parseFloat(volume.toFixed(2)),
          });
        }

        // Return in chronological order (oldest first)
        resolve(bars.reverse());
      } catch (err) {
        reject(err);
      }
    }, 200 + Math.random() * 300);
  });
}

/**
 * Fetches historical bars (OHLCV) for a symbol and interval within a date range from IBKR (simulated)
 * with pagination to handle large date ranges by splitting into valid IBKR duration windows.
 * @param symbol Trading pair symbol
 * @param interval Bar size (e.g., '1 min', '5 mins', '1 day')
 * @param startDate Start date (ISO string or timestamp milliseconds)
 * @param endDate End date (ISO string or timestamp milliseconds). If not provided, uses now.
 * @returns Promise with array of bars in chronological order (oldest first) without duplicates
 */
export async function getIBKRCandlesInDateRange(
  symbol: string,
  interval: string,
  startDate: string | number,
  endDate?: string | number
): Promise<Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>> {
  // Convert start and end dates to milliseconds
  let startTimeMs: number;
  if (typeof startDate === 'string') {
    startTimeMs = Date.parse(startDate);
    if (isNaN(startTimeMs)) {
      throw new Error(`Invalid startDate string: ${startDate}`);
    }
  } else {
    startTimeMs = startDate;
  }

  let endTimeMs: number;
  if (endDate !== undefined) {
    if (typeof endDate === 'string') {
      endTimeMs = Date.parse(endDate);
      if (isNaN(endTimeMs)) {
        throw new Error(`Invalid endDate string: ${endDate}`);
      }
    } else {
      endTimeMs = endDate;
    }
  } else {
    endTimeMs = Date.now();
  }

  // Ensure start is before end
  if (startTimeMs >= endTimeMs) {
    throw new Error('startDate must be before endDate');
  }

  const intervalMs = parseIntervalToMs(interval);
  const maxLookbackMs = getMaxLookbackMs(interval);

  // Array to hold all bars
  const allBars: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> = [];

  // We'll iterate backwards from endTimeMs to startTimeMs in chunks of maxLookbackMs
  let currentEnd = endTimeMs;
  while (currentEnd > startTimeMs) {
    const chunkStart = Math.max(currentEnd - maxLookbackMs, startTimeMs);
    // Calculate the number of bars needed for this chunk
    const barCount = Math.ceil((currentEnd - chunkStart) / intervalMs) + 1; // +1 to be safe
    // Ensure we don't exceed max bars per request (though getMaxLookbackMs already considers this)
    const count = Math.min(barCount, MAX_BARS_PER_REQUEST);
    const chunkBars = await getIBKRCandles(symbol, interval, count, currentEnd);
    // Filter bars to only those within [chunkStart, currentEnd] (since we might have extra due to rounding)
    const filtered = chunkBars.filter(bar => bar.time >= chunkStart && bar.time < currentEnd);
    allBars.push(...filtered);
    // Move to the next chunk (going backwards)
    currentEnd = chunkStart;
  }

  // Sort by time ascending
  allBars.sort((a, b) => a.time - b.time);

  // Remove duplicates (based on time) - keep first occurrence
  const uniqueBars = allBars.filter((bar, index, self) =>
    index === self.findIndex(b => b.time === bar.time)
  );

  return uniqueBars;
}

/**
 * Adds a market price record from IBKR to the finance store
 * @param symbol Trading symbol
 * @param price Current price
 * @param bid Bid price (optional)
 * @param ask Ask price (optional)
 * @param volume Volume (optional)
 * @param source Source identifier (defaults to 'ibkr-paper-api')
 * @returns Updated finance database
 */
export function addIBKRLMarketPrice(
  symbol: string,
  price: number,
  bid: number | undefined,
  ask: number | undefined,
  volume: number | undefined,
  source: string = 'ibkr-paper-api'
): FinanceDatabase {
  const db = ensureFinanceStore();
  const marketPrice = {
    id: randomUUID(),
    platform: 'ibkr',
    symbol,
    price,
    bid,
    ask,
    spread: bid !== undefined && ask !== undefined ? ask - bid : undefined,
    volume,
    currency: 'USD', // Assuming USD for IBKR, could be made configurable
    observedAt: new Date().toISOString(),
    source,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.market_prices.push(marketPrice);
  writeFinanceStore(db);
  appendAuditLog('ibkr_market_price_added', { symbol, price, platform: 'ibkr' });
  return db;
}

/**
 * Persists a batch of simulated IBKR historical candles in a single store write.
 * The bar `time` is the bar start; `closedAt` is derived as start + interval.
 * @param source Data source identifier (defaults to 'ibkr-paper-api')
 */
export function addIBKRCandles(
  symbol: string,
  interval: string,
  bars: Array<{
    time: number; // Unix timestamp in milliseconds (bar start time)
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>,
  source: string = 'ibkr-paper-api'
): FinanceDatabase {
  const db = ensureFinanceStore();
  const now = new Date().toISOString();
  const intervalMs = parseIntervalToMs(interval);
  for (const b of bars) {
    db.historical_candles.push({
      id: randomUUID(),
      platform: 'ibkr',
      symbol,
      interval,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      openedAt: new Date(b.time).toISOString(),
      closedAt: new Date(b.time + intervalMs).toISOString(),
      source,
      createdAt: now,
      updatedAt: now,
    });
  }
  writeFinanceStore(db);
  appendAuditLog('ibkr_historical_candles_added', { symbol, interval, count: bars.length, platform: 'ibkr' });
  return db;
}