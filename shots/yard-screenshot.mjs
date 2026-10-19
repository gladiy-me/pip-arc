import { chromium } from 'playwright'
import { writeFile } from 'fs/promises'

import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:5173'

const executablePath =
  '/home/sandbox/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'

const ENV = {
  ...process.env,
  LD_LIBRARY_PATH: [
    '/tmp/chromium-libs/usr/lib/x86_64-linux-gnu',
    '/tmp/chromium-libs/usr/lib',
    process.env.LD_LIBRARY_PATH || '',
  ].filter(Boolean).join(':'),
  FONTCONFIG_FILE: '/tmp/fontconfig/fonts.conf',
}

const LAUNCH_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
  '--renderer-process-limit=1', '--no-first-run', '--no-default-browser-check',
]

async function takeShot(viewport, outputPath, postLoadFn) {
  const browser = await chromium.launch({ executablePath, headless: true, args: LAUNCH_ARGS, env: ENV })
  try {
    const ctx  = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    let alive = true
    page.on('crash', () => { alive = false })

    await page.goto(BASE, { waitUntil: 'load', timeout: 30000 })

    // Wait for yard content to appear
    const deadline = Date.now() + 15000
    while (Date.now() < deadline && alive) {
      try {
        const ready = await page.evaluate(
          () => !document.body.innerText.includes('booting pip') &&
                (document.body.innerText.includes("pip's yard") ||
                 document.body.innerText.includes('pip.exe'))
        )
        if (ready) break
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 300))
    }

    // Extra settle for animations
    await new Promise(r => setTimeout(r, 3000))

    if (postLoadFn) { await postLoadFn(page); await new Promise(r => setTimeout(r, 1500)) }

    const buf = await page.screenshot({ fullPage: viewport.width < 500, timeout: 15000 })
    await writeFile(outputPath, buf)
    await writeFile(outputPath.replace('.png', '.b64'), buf.toString('base64'))
    console.log('saved', path.basename(outputPath), `(${buf.length} bytes)`)
  } finally {
    await browser.close().catch(() => {})
  }
}

console.log('yard-mobile.png...')
await takeShot({ width: 430, height: 932 }, path.join(__dirname, 'yard-mobile.png'), null)

console.log('yard-desktop.png...')
await takeShot({ width: 1440, height: 1000 }, path.join(__dirname, 'yard-desktop.png'), null)

console.log('done')
