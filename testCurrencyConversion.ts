import { ensureFinanceStore, updateExchangeRate, getExchangeRate, convertCurrency, FinanceDatabase } from './src/server/finance-store';

// Helper to get a date string in YYYY-MM-DD format
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

console.log('=== Testing Exchange Rate and Currency Conversion ===');

// Ensure the finance store is initialized
let db: FinanceDatabase = ensureFinanceStore();
console.log('Finance store initialized.');

// Add some exchange rates with different dates
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
const twoDaysAgo = new Date(today);
twoDaysAgo.setDate(today.getDate() - 2);

const todayStr = formatDate(today);
const yesterdayStr = formatDate(yesterday);
const twoDaysAgoStr = formatDate(twoDaysAgo);

// Add LKR to USD rate: 1 LKR = 0.004 USD (example)
db = updateExchangeRate('LKR', 'USD', 0.004, twoDaysAgoStr);
// Update LKR to USD rate yesterday: 1 LKR = 0.0045 USD
db = updateExchangeRate('LKR', 'USD', 0.0045, yesterdayStr);
// Update LKR to USD rate today: 1 LKR = 0.005 USD
db = updateExchangeRate('LKR', 'USD', 0.005, todayStr);

// Add USD to LKR rate (inverse) for testing inverse path
// 1 USD = 250 LKR (approx 1/0.004)
db = updateExchangeRate('USD', 'LKR', 250, twoDaysAgoStr);
db = updateExchangeRate('USD', 'LKR', 222.22, yesterdayStr); // 1/0.0045
db = updateExchangeRate('USD', 'LKR', 200, todayStr); // 1/0.005

// Also add a direct EUR to LKR rate for testing via base currency
// Let's say 1 EUR = 200 LKR
db = updateExchangeRate('EUR', 'LKR', 200, todayStr);
// And LKR to EUR: 1 LKR = 0.005 EUR
db = updateExchangeRate('LKR', 'EUR', 0.005, todayStr);

console.log('\n--- Exchange rates added ---');
console.log('LKR/USD rates:', db.exchange_rates
  .filter((r: any) => r.base === 'LKR' && r.target === 'USD')
  .map((r: any) => ({ date: r.date, rate: r.rate })));

console.log('USD/LKR rates:', db.exchange_rates
  .filter((r: any) => r.base === 'USD' && r.target === 'LKR')
  .map((r: any) => ({ date: r.date, rate: r.rate })));

// Test getExchangeRate without date (should return latest)
console.log('\n--- getExchangeRate without date (latest) ---');
const rateLkrUsdToday = getExchangeRate('LKR', 'USD');
console.log(`LKR to USD (latest): ${rateLkrUsdToday}`); // Expected 0.005

const rateUsdLkrToday = getExchangeRate('USD', 'LKR');
console.log(`USD to LKR (latest): ${rateUsdLkrToday}`); // Expected 200

// Test getExchangeRate with a specific date
console.log('\n--- getExchangeRate with specific date ---');
const rateLkrUsdYesterday = getExchangeRate('LKR', 'USD', yesterdayStr);
console.log(`LKR to USD on ${yesterdayStr}: ${rateLkrUsdYesterday}`); // Expected 0.0045

const rateLkrUsdTwoDaysAgo = getExchangeRate('LKR', 'USD', twoDaysAgoStr);
console.log(`LKR to USD on ${twoDaysAgoStr}: ${rateLkrUsdTwoDaysAgo}`); // Expected 0.004

// Test getExchangeRate with a date before any data (should return undefined)
const longAgo = formatDate(new Date(2020, 0, 1));
const rateLongAgo = getExchangeRate('LKR', 'USD', longAgo);
console.log(`LKR to USD on ${longAgo}: ${rateLongAgo}`); // Expected undefined

// Test convertCurrency without date (should use latest rates)
console.log('\n--- convertCurrency without date (latest rates) ---');
let amountLkr = 1000; // 1000 LKR
let convertedUsd = convertCurrency(amountLkr, 'LKR', 'USD');
console.log(`${amountLkr} LKR to USD (latest): ${convertedUsd}`); // Expected 1000 * 0.005 = 5

amountLkr = 2000;
convertedUsd = convertCurrency(amountLkr, 'LKR', 'USD');
console.log(`${amountLkr} LKR to USD (latest): ${convertedUsd}`); // Expected 2000 * 0.005 = 10

// Test convertCurrency with date
console.log('\n--- convertCurrency with specific date ---');
amountLkr = 1000;
convertedUsd = convertCurrency(amountLkr, 'LKR', 'USD', yesterdayStr);
console.log(`${amountLkr} LKR to USD on ${yesterdayStr}: ${convertedUsd}`); // Expected 1000 * 0.0045 = 4.5

convertedUsd = convertCurrency(amountLkr, 'LKR', 'USD', twoDaysAgoStr);
console.log(`${amountLkr} LKR to USD on ${twoDaysAgoStr}: ${convertedUsd}`); // Expected 1000 * 0.004 = 4

// Test same currency conversion
console.log('\n--- Same currency conversion ---');
const same = convertCurrency(500, 'LKR', 'LKR');
console.log(`500 LKR to LKR: ${same}`); // Expected 500

// Test conversion via base currency (LKR) - we already have direct, but let's test EUR to USD via LKR
// We have EUR->LKR rate: 1 EUR = 200 LKR
// We have LKR->USD rate: 1 LKR = 0.005 USD
// So 1 EUR should be 200 * 0.005 = 1 USD
console.log('\n--- Convert via base currency (EUR to USD via LKR) ---');
let amountEur = 1;
let convertedVia = convertCurrency(amountEur, 'EUR', 'USD');
console.log(`${amountEur} EUR to USD (via LKR): ${convertedVia}`); // Expected 1 * 200 * 0.005 = 1

amountEur = 10;
convertedVia = convertCurrency(amountEur, 'EUR', 'USD');
console.log(`${amountEur} EUR to USD (via LKR): ${convertedVia}`); // Expected 10 * 200 * 0.005 = 10

// Test inverse rate: if we have USD->LKR, we can get LKR->USD by 1/rate
// We already have direct, but let's test by converting 1 USD to LKR and back
const usdToLkr = convertCurrency(1, 'USD', 'LKR');
console.log(`1 USD to LKR: ${usdToLkr}`); // Expected 200
const lkrToUsdBack = convertCurrency(usdToLkr!, 'LKR', 'USD');
console.log(`${usdToLkr} LKR back to USD: ${lkrToUsdBack}`); // Expected 1

// Test invalid conversion (no rate available)
console.log('\n--- Conversion with no rate available (e.g., EUR to JPY) ---');
const noRate = convertCurrency(100, 'EUR', 'JPY');
console.log(`100 EUR to JPY (no rate): ${noRate}`); // Expected undefined

console.log('\n=== All tests completed ===');