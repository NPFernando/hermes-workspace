import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const VIEWPORTS = [
  { name: '375-mobile',    width: 375,  height: 812  },
  { name: '768-tablet',    width: 768,  height: 1024 },
  { name: '1024-tablet-l', width: 1024, height: 768  },
  { name: '1280-laptop',   width: 1280, height: 800  },
  { name: '1920-fullhd',   width: 1920, height: 1080 },
]

const PREFIX = process.argv[2] ?? 'before'

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()

  await page.goto('http://127.0.0.1:3000/chat/main', { timeout: 20000 })

  // Wait for the startup screen to go away (connection-startup-screen disappears)
  await page.waitForFunction(
    () => !document.querySelector('.connection-startup') && document.querySelector('[data-tour="chat-area"]'),
    { timeout: 10000 }
  ).catch(() => {/* may not have [data-tour] — just wait */})

  await page.waitForTimeout(1500)

  const file = `${__dirname}/${PREFIX}-${vp.name}.png`
  await page.screenshot({ path: file })
  console.log(`✓ ${PREFIX}-${vp.name}  (${vp.width}×${vp.height})`)
  await ctx.close()
}

await browser.close()
