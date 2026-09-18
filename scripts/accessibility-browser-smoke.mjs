#!/usr/bin/env node
/**
 * Lightweight browser accessibility smoke. This is intentionally dependency
 * free beyond the repository's existing Playwright install; it is not a
 * replacement for a full WCAG audit.
 */
import { chromium } from 'playwright'

const baseUrl =
  process.env.ACCESSIBILITY_BASE_URL ||
  process.argv[2] ||
  'http://127.0.0.1:3000'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const failures = []
const assetFailures = []

page.on('response', async (response) => {
  const request = response.request()
  const resourceType = request.resourceType()
  const url = response.url()
  const asset =
    ['script', 'stylesheet', 'font'].includes(resourceType) ||
    /\.(?:js|mjs|css|woff2?|ttf|otf)(?:[?#]|$)/i.test(url)
  if (!asset) return
  const contentType = response.headers()['content-type'] || ''
  const expectedType = resourceType === 'stylesheet' ? /text\/css/i : resourceType === 'script' ? /javascript|ecmascript/i : true
  if (response.status() >= 400 || (expectedType !== true && !expectedType.test(contentType))) {
    assetFailures.push({
      resourceType,
      status: response.status(),
      contentType,
      url,
    })
  }
})

try {
  const response = await page.goto(`${baseUrl}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  if (!response || response.status() >= 400)
    failures.push(`root returned HTTP ${response?.status() ?? 'unknown'}`)
  await page
    .waitForFunction(
      () =>
        Boolean(
          document.querySelector(
            'button, a[href], input, select, textarea, [role="button"], [role="link"]',
          ),
        ),
      null,
      { timeout: 10_000 },
    )
    .catch(() => {})
  // Allow late stylesheet/script responses to be recorded before the DOM and
  // keyboard checks run. This remains bounded and does not wait on app polling.
  await page.waitForTimeout(250)
  if (assetFailures.length)
    failures.push(
      `asset load failures: ${assetFailures.slice(0, 8).map((asset) => `${asset.status} ${asset.resourceType} ${asset.url}`).join('; ')}`,
    )

  const audit = await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element)
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getBoundingClientRect().width > 0
      )
    }
    const labelledBy = (element) =>
      (element.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .trim()
    const associatedLabel = (element) => {
      if (element.id) {
        const label = document.querySelector(
          `label[for="${CSS.escape(element.id)}"]`,
        )
        if (label) return label.textContent || ''
      }
      return element.closest('label')?.textContent || ''
    }
    const accessibleName = (element) =>
      (
        element.getAttribute('aria-label') ||
        labelledBy(element) ||
        associatedLabel(element) ||
        element.getAttribute('title') ||
        element.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
    const focusableSelector =
      'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
    const interactive = [
      ...document.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="link"]',
      ),
    ].filter(
      (element) =>
        visible(element) &&
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-hidden') !== 'true',
    )
    const unnamed = interactive
      .filter((element) => !accessibleName(element))
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`,
      )
    const imagesMissingAlt = [...document.images]
      .filter(
        (image) =>
          visible(image) &&
          image.getAttribute('aria-hidden') !== 'true' &&
          !image.hasAttribute('alt'),
      )
      .map((image) => image.src)
    const ids = [...document.querySelectorAll('[id]')].map(
      (element) => element.id,
    )
    const duplicateIds = [
      ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
    ]
    const unlabeledDialogs = [
      ...document.querySelectorAll('[role="dialog"]'),
    ].filter(
      (element) =>
        !element.getAttribute('aria-label') &&
        !element.getAttribute('aria-labelledby'),
    ).length
    const hiddenFocusable = [
      ...document.querySelectorAll('[aria-hidden="true"]'),
    ]
      .flatMap((root) => [root, ...root.querySelectorAll(focusableSelector)])
      .filter((element) => element.matches?.(focusableSelector))
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`,
      )
    const positiveTabindex = [...document.querySelectorAll('[tabindex]')]
      .filter((element) => Number(element.getAttribute('tabindex')) > 0)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`,
      )
    const unlabeledFormControls = [
      ...document.querySelectorAll(
        'input:not([type="hidden"]), select, textarea',
      ),
    ]
      .filter((element) => visible(element) && !accessibleName(element))
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`,
      )
    return {
      unnamed,
      imagesMissingAlt,
      duplicateIds,
      unlabeledDialogs,
      hiddenFocusable,
      positiveTabindex,
      unlabeledFormControls,
      title: document.title,
    }
  })
  if (audit.unnamed.length)
    failures.push(
      `unnamed interactive controls: ${audit.unnamed.slice(0, 12).join(', ')}`,
    )
  if (audit.imagesMissingAlt.length)
    failures.push(`images missing alt text: ${audit.imagesMissingAlt.length}`)
  if (audit.duplicateIds.length)
    failures.push(`duplicate ids: ${audit.duplicateIds.join(', ')}`)
  if (audit.unlabeledDialogs)
    failures.push(
      `${audit.unlabeledDialogs} dialog(s) missing an accessible label`,
    )
  if (audit.hiddenFocusable.length)
    failures.push(
      `focusable controls inside aria-hidden content: ${audit.hiddenFocusable.slice(0, 12).join(', ')}`,
    )
  if (audit.positiveTabindex.length)
    failures.push(
      `positive tabindex values: ${audit.positiveTabindex.join(', ')}`,
    )
  if (audit.unlabeledFormControls.length)
    failures.push(
      `unlabeled form controls: ${audit.unlabeledFormControls.slice(0, 12).join(', ')}`,
    )

  const focusTargets = []
  const focusPath = []
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const element = document.activeElement
      return {
        tag: element?.tagName || '',
        id: element?.id || '',
        name:
          element?.getAttribute('aria-label') ||
          element?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) ||
          '',
        insideAriaHidden: Boolean(element?.closest('[aria-hidden="true"]')),
      }
    })
    focusTargets.push(focused.tag)
    focusPath.push(focused)
    if (focused.insideAriaHidden)
      failures.push(
        `keyboard focus entered aria-hidden content at Tab ${index + 1}`,
      )
  }
  if (focusTargets.every((tag) => !tag || tag === 'BODY'))
    failures.push('keyboard Tab did not reach a focusable control')

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        url: baseUrl,
        title: audit.title,
        focusTargets,
        focusPath,
        assetFailures,
        audit,
        failures,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}

if (failures.length) process.exitCode = 1
