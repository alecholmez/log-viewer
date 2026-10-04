// Screenshots of the app for the website in site/, taken from the real UI on the logs in testdata/logs.
//
//   npm run build && cargo build --release -p logviewer-dev && npm run site:shots
//
// Writes site/img/<name>.webp at twice the size the page shows them, and site/og.png, the link preview.
// The website is dark for every visitor, so the app is photographed in its dark theme.
// Prints each image's size in CSS pixels; the width and height attributes in site/index.html must match.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { root, startServer, libraryOpen, importLogs } from './server.mjs';

const site = join(root, 'site');
const out = join(site, 'img');
mkdirSync(out, { recursive: true });
const { url, stop } = await startServer(1438);

// Chromium encodes the WebP: nothing else on a developer machine or in CI is sure to
const toWebp = async (page, png) => {
  const b64 = await page.evaluate(async data => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 })).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, png.toString('base64'));
  return Buffer.from(b64, 'base64');
};

let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    await page.goto(url);
    await libraryOpen(page);
    if ((await page.locator('#logs .log').count()) === 0) {
      await importLogs(page);
      // a fresh page drops the message about the import from the header
      await page.reload();
      await libraryOpen(page);
    }
    // three pulls on the chart: the default two and the strongest
    await page.locator('.pull', { hasText: '3rd gear · 4,325' }).locator('button.r2').click();
    await page.waitForFunction(() => document.querySelectorAll('#stats .stat').length === 3);
    // the playhead in the middle of the pull
    await page.evaluate(() => {
      const scrub = document.getElementById('scrub');
      scrub.value = '520';
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // the list of logs starts at the log the three pulls are from
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.log-head')];
      heads.find(h => h.textContent.includes('1:45 pm log')).scrollIntoView({ block: 'start' });
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);

    const save = async (name, clip) => {
      const png = await page.screenshot(clip ? { clip } : {});
      const file = name + '.webp';
      const webp = await toWebp(page, png);
      writeFileSync(join(out, file), webp);
      const size = clip ?? page.viewportSize();
      console.log(file.padEnd(24), Math.round(size.width) + ' × ' + Math.round(size.height), (webp.length / 1024).toFixed(0) + ' kB');
    };
    const box = sel => page.locator(sel).first().boundingBox();

    await save('hero');

    // tall enough that every panel is on screen, so a clip never needs scrolling
    await page.setViewportSize({ width: 1400, height: 3600 });
    await page.waitForTimeout(300);
    await save('power', await box('section[aria-labelledby="h-dyno"]'));
    await save('table', await box('#table-panel'));
    const findings = await box('section[aria-labelledby="h-find"]');
    await save('findings', { ...findings, height: Math.min(findings.height, 700) });
    // two single findings for narrow screens, where the panel would be too small to read; the second is opened first
    await save('finding-boost', await box('#find-all .finding:has-text("Lean of target under boost")'));
    const fuel = '#find-all .finding:has(button:has-text("Open fuel table"))';
    await page.locator(fuel).first().locator('summary').click();
    await save('finding-fuel', await box(fuel));
    const [readouts, traces] = [await box('#readouts'), await box('#tr-wrap')];
    await save('replay', { x: readouts.x, y: readouts.y, width: readouts.width, height: traces.y + traces.height - readouts.y });
    await page.close();
  }

  // the link preview is the top of the website itself, served from disk under a made-up origin: a page opened as a file gets no fonts
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, reducedMotion: 'reduce' });
  await page.route('http://site.test/**', route => route.fulfill({ path: join(site, new URL(route.request().url()).pathname) }));
  await page.goto('http://site.test/index.html');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(site, 'og.png') });
  console.log('og.png'.padEnd(24), '1200 × 630');
} finally {
  await browser?.close();
  stop();
}
