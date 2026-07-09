import { fetchBinanceKlines, addBinanceCandles } from '../src/server/binance-market.service';
import { fetchBinanceTickerPrice, addMarketPrice } from '../src/server/binance-market.service';
import { fetchBinanceOrderBook } from '../src/server/binance-market.service';
import { ensureFinanceStore } from '../src/server/finance-store';

async function main() {
  console.log('Starting market data verification flow for BTCUSDT...');

  try {
    // Step 1: Fetch and store BTCUSDT 1h candles (last 24 hours)
    console.log('Fetching 24h of 1h candles for BTCUSDT...');
    const candles = await fetchBinanceKlines('BTCUSDT', '1h', 24);
    if (!candles || candles.length === 0) {
      throw new Error('No candles returned from Binance');
    }
    console.log(`Fetched ${candles.length} candles`);

    // Store candles
    addBinanceCandles('BTCUSDT', '1h', candles);
    console.log('Successfully stored candles in finance store');

    // Step 2: Retrieve latest WebSocket price (ticker)
    console.log('Fetching latest ticker price for BTCUSDT...');
    const ticker = await fetchBinanceTickerPrice('BTCUSDT');
    if (!ticker || typeof ticker.price !== 'number') {
      throw new Error('Invalid ticker response');
    }
    console.log(`Latest price: ${ticker.price}`);

    // Store ticker price
    addMarketPrice('BTCUSDT', ticker.price, undefined, undefined, undefined, 'binance', 'binance-public-api');
    console.log('Successfully stored ticker price in finance store');

    // Step 3: Fetch depth snapshot (order book)
    console.log('Fetching order book depth for BTCUSDT...');
    const orderBook = await fetchBinanceOrderBook('BTCUSDT', 100);
    if (!orderBook.bids || orderBook.bids.length === 0 || !orderBook.asks || orderBook.asks.length === 0) {
      throw new Error('Invalid order book response: missing bids or asks');
    }
    console.log(`Order book bids: ${orderBook.bids.length}, asks: ${orderBook.asks.length}`);
    // We could store the order book if needed, but for verification we just check validity

    // Step 4: Calculate 24h volatility from candles
    console.log('Calculating 24h volatility from candles...');
    if (candles.length < 2) {
      throw new Error('Not enough candles to calculate volatility');
    }
    // Calculate log returns: ln(current_close / previous_close)
    const logReturns: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prevClose = candles[i-1].close;
      const currClose = candles[i].close;
      if (prevClose <= 0) continue; // avoid division by zero or negative
      const logReturn = Math.log(currClose / prevClose);
      logReturns.push(logReturn);
    }
    if (logReturns.length === 0) {
      throw new Error('No valid log returns calculated');
    }
    // Calculate standard deviation of log returns
    const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / logReturns.length;
    const volatility = Math.sqrt(variance); // This is the volatility of 1h returns
    // We have 24 hours of 1h data, so the standard deviation of the 24 hourly returns is the 24h volatility
    console.log(`24h volatility (std of hourly log returns): ${volatility}`);

    console.log('✅ All steps completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();