import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await mkdir(__dirname, { recursive: true });

const BASE = 'http://localhost:5173';

const executablePath =
  '/home/sandbox/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';

const ENV = {
  ...process.env,
  LD_LIBRARY_PATH: [
    '/tmp/chromium-libs/usr/lib/x86_64-linux-gnu',
    '/tmp/chromium-libs/usr/lib',
    process.env.LD_LIBRARY_PATH || '',
  ].filter(Boolean).join(':'),
  FONTCONFIG_FILE: '/tmp/fontconfig/fonts.conf',
};

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--renderer-process-limit=1',
  '--no-first-run',
  '--no-default-browser-check',
];

async function takeShot(viewport, outputPath, postLoadFn) {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: LAUNCH_ARGS,
    env: ENV,
  });

  try {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();

    let alive = true;
    page.on('crash', () => { alive = false; console.log('page crashed'); });

    await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
    console.log('page loaded');

    // Poll for onchain data: wait until "booting pip" disappears (max 20s)
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && alive) {
      try {
        const ready = await page.evaluate(
          () => !document.body.innerText.includes('booting pip') &&
                document.body.innerText.includes('pip.exe')
        );
        if (ready) { console.log('onchain data loaded'); break; }
      } catch {}
      await new Promise(r => setTimeout(r, 300));
    }

    if (!alive) throw new Error('page crashed before screenshot');

    // Extra settle for any pending RPC responses
    await new Promise(r => setTimeout(r, 3000));

    if (postLoadFn) {
      await postLoadFn(page);
      await new Promise(r => setTimeout(r, 1500));
    }

    const buf = await page.screenshot({ fullPage: true, timeout: 15000 });
    await writeFile(outputPath, buf);
    console.log('saved', path.basename(outputPath), `(${buf.length} bytes)`);
  } finally {
    await browser.close().catch(() => {});
  }
}

console.log('Taking mobile.png...');
await takeShot(
  { width: 430, height: 932 },
  path.join(__dirname, 'mobile.png'),
  null
);

console.log('Taking desktop.png...');
await takeShot(
  { width: 1440, height: 1000 },
  path.join(__dirname, 'desktop.png'),
  null
);

console.log('Taking graveyard.png...');
await takeShot(
  { width: 430, height: 932 },
  path.join(__dirname, 'graveyard.png'),
  async (page) => {
    const btn = page.locator('button', { hasText: '[ graveyard ]' }).first();
    await btn.click({ timeout: 5000 });
  }
);

console.log('all done');
