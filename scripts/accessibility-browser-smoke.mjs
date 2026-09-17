#!/usr/bin/env node
/**
 * Lightweight browser accessibility smoke. This is intentionally dependency
 * free beyond the repository's existing Playwright install; it is not a
 * replacement for a full WCAG audit.
 */
import { chromium } from 'playwright'

const baseUrl = process.env.ACCESSIBILITY_BASE_URL || process.argv[2] || 'http://127.0.0.1:3000'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const failures = []

try {
  const response = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  if (!response || response.status() >= 400) failures.push(`root returned HTTP ${response?.status() ?? 'unknown'}`)
  await page.waitForFunction(
    () => Boolean(document.querySelector('button, a[href], input, select, textarea, [role="button"], [role="link"]')),
    null,
    { timeout: 10_000 },
  ).catch(() => {})

  const audit = await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0
    }
    const labelledBy = (element) => (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim()
    const associatedLabel = (element) => {
      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
        if (label) return label.textContent || ''
      }
      return element.closest('label')?.textContent || ''
    }
    const accessibleName = (element) => (element.getAttribute('aria-label') || labelledBy(element) || associatedLabel(element) || element.getAttribute('title') || element.textContent || '').replace(/\s+/g, ' ').trim()
    const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"]')]
      .filter((element) => visible(element) && !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
    const unnamed = interactive.filter((element) => !accessibleName(element)).map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`)
    const imagesMissingAlt = [...document.images].filter((image) => visible(image) && image.getAttribute('aria-hidden') !== 'true' && !image.hasAttribute('alt')).map((image) => image.src)
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
    const unlabeledDialogs = [...document.querySelectorAll('[role="dialog"]')].filter((element) => !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).length
    return { unnamed, imagesMissingAlt, duplicateIds, unlabeledDialogs, title: document.title }
  })
  if (audit.unnamed.length) failures.push(`unnamed interactive controls: ${audit.unnamed.slice(0, 12).join(', ')}`)
  if (audit.imagesMissingAlt.length) failures.push(`images missing alt text: ${audit.imagesMissingAlt.length}`)
  if (audit.duplicateIds.length) failures.push(`duplicate ids: ${audit.duplicateIds.join(', ')}`)
  if (audit.unlabeledDialogs) failures.push(`${audit.unlabeledDialogs} dialog(s) missing an accessible label`)

  const focusTargets = []
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab')
    focusTargets.push(await page.evaluate(() => document.activeElement?.tagName || ''))
  }
  if (focusTargets.every((tag) => !tag || tag === 'BODY')) failures.push('keyboard Tab did not reach a focusable control')

  console.log(JSON.stringify({ ok: failures.length === 0, url: baseUrl, title: audit.title, focusTargets, audit, failures }, null, 2))
} finally {
  await browser.close()
}

if (failures.length) process.exitCode = 1
