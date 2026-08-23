/**
 * Public, read-only finance news ingestion using Google News RSS.
 * No credentials, provider SDKs, or trading-engine imports are used here.
 */
import { createHash } from 'node:crypto'
import * as https from 'node:https'
import { storeFinanceNewsItems } from './finance-store'
import type { NewsItem } from './finance-store'

const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search'
const REQUEST_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_ITEMS = 25

export type GoogleNewsRssItem = Pick<
  NewsItem,
  | 'id'
  | 'sourceName'
  | 'sourceUrl'
  | 'publishDate'
  | 'relatedSymbol'
  | 'summary'
  | 'sentiment'
  | 'riskImpact'
  | 'confidenceScore'
  | 'changedDecision'
  | 'source'
  | 'createdAt'
  | 'updatedAt'
>

function httpsGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'user-agent': 'HermesFinanceResearch/1.0' } },
      (response) => {
        if ((response.statusCode ?? 500) >= 400) {
          response.resume()
          reject(new Error(`Google News RSS returned HTTP ${response.statusCode}`))
          return
        }
        let bytes = 0
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk)
          if (bytes > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Google News RSS response exceeded maximum allowed size'))
            return
          }
          body += chunk
        })
        response.on('end', () => resolve(body))
      },
    )
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Google News RSS request timed out after ${REQUEST_TIMEOUT_MS}ms`))
    })
    request.on('error', (error) => reject(new Error(`Failed to fetch Google News RSS: ${error.message}`)))
  })
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  const value = match?.[1] ? decodeXml(match[1]) : ''
  return value || undefined
}

function normalizePublisherUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(decodeXml(value))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    url.hash = ''
    url.search = ''
    if (url.pathname === '/') url.pathname = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

function sourceFromItem(item: string): { sourceName: string; sourceUrl: string } {
  const sourceMatch = item.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i)
  const sourceName = decodeXml(sourceMatch?.[2] ?? '') || 'Google News'
  const urlAttribute = sourceMatch?.[1]?.match(/\burl\s*=\s*["']([^"']+)["']/i)?.[1]
  // Google News' item link is a redirect. Store the publisher's URL from
  // <source url>, never the redirect URL, so callers receive a stable source.
  const sourceUrl = normalizePublisherUrl(urlAttribute) ?? 'https://news.google.com'
  return { sourceName, sourceUrl }
}

export function googleNewsRssUrl(symbol: string): string {
  const query = `${symbol} when:7d`
  return `${GOOGLE_NEWS_RSS}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
}

export function parseGoogleNewsRss(
  xml: string,
  symbol: string,
  now = new Date().toISOString(),
): Array<GoogleNewsRssItem> {
  const normalizedSymbol = symbol.trim().toUpperCase()
  if (!normalizedSymbol) throw new Error('symbol is required')

  const seen = new Set<string>()
  const items: Array<GoogleNewsRssItem> = []
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (items.length >= MAX_ITEMS) break
    const item = match[1]
    const title = tagValue(item, 'title')
    if (!title) continue
    const { sourceName, sourceUrl } = sourceFromItem(item)
    const published = tagValue(item, 'pubDate')
    const publishDate = published && !Number.isNaN(Date.parse(published))
      ? new Date(published).toISOString()
      : undefined
    const description = tagValue(item, 'description')
    const summary = description ? `${title} — ${description}` : title
    const fingerprint = `${normalizedSymbol}\n${sourceUrl}\n${publishDate ?? ''}\n${title}`
    const id = `google-news-rss:${createHash('sha256').update(fingerprint).digest('hex').slice(0, 24)}`
    if (seen.has(id)) continue
    seen.add(id)
    items.push({
      id,
      sourceName,
      sourceUrl,
      publishDate,
      relatedSymbol: normalizedSymbol,
      summary,
      sentiment: 'unknown',
      riskImpact: 'medium_risk',
      confidenceScore: 0,
      changedDecision: false,
      source: 'google-news-rss',
      createdAt: now,
      updatedAt: now,
    })
  }
  return items
}

export async function fetchAndStoreGoogleNews(
  symbol: string,
  fetchText: (url: string) => Promise<string> = httpsGetText,
): Promise<{ fetched: number; stored: number; items: Array<GoogleNewsRssItem> }> {
  const normalizedSymbol = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{1,20}$/.test(normalizedSymbol))
    throw new Error('symbol must contain only letters and numbers')
  const items = parseGoogleNewsRss(await fetchText(googleNewsRssUrl(normalizedSymbol)), normalizedSymbol)
  return { fetched: items.length, stored: storeFinanceNewsItems(items), items }
}
