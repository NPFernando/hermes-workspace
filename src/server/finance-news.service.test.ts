import { describe, expect, it } from 'vitest'
import { googleNewsRssUrl, parseGoogleNewsRss } from './finance-news.service'

const RSS = `<?xml version="1.0"?><rss><channel>
  <item>
    <title><![CDATA[Bitcoin &amp; Markets Rise]]></title>
    <pubDate>Tue, 04 Aug 2026 12:30:00 GMT</pubDate>
    <description><![CDATA[<p>A short market update.</p>]]></description>
    <source url="HTTPS://Example.COM/path/?utm_source=google#fragment">Example &amp; Co</source>
  </item>
  <item>
    <title>Bitcoin &amp; Markets Rise</title>
    <pubDate>Tue, 04 Aug 2026 12:30:00 GMT</pubDate>
    <source url="https://example.com/path/">Example &amp; Co</source>
  </item>
</channel></rss>`

describe('finance-news.service', () => {
  it('builds a Google News RSS query for a finance symbol', () => {
    expect(googleNewsRssUrl('BTCUSDT')).toContain('q=BTCUSDT%20when%3A7d')
  })

  it('uses the RSS publisher source, normalizes its URL, and de-duplicates items', () => {
    const [item] = parseGoogleNewsRss(RSS, 'btcusdt', '2026-08-04T13:00:00.000Z')

    expect(parseGoogleNewsRss(RSS, 'BTCUSDT')).toHaveLength(1)
    expect(item).toMatchObject({
      sourceName: 'Example & Co',
      sourceUrl: 'https://example.com/path',
      relatedSymbol: 'BTCUSDT',
      sentiment: 'unknown',
      riskImpact: 'medium_risk',
      source: 'google-news-rss',
    })
    expect(item.publishDate).toBe('2026-08-04T12:30:00.000Z')
    expect(item.summary).toContain('Bitcoin & Markets Rise')
    expect(item.sourceUrl).not.toContain('news.google.com')
  })

  it('falls back to Google News only when an RSS source is absent', () => {
    const [item] = parseGoogleNewsRss('<rss><item><title>Headline</title></item></rss>', 'ETHUSDT')
    expect(item).toMatchObject({
      sourceName: 'Google News',
      sourceUrl: 'https://news.google.com',
    })
  })
})
