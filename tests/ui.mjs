// End-to-end check of the UI against the real core, in a browser.
//
//   npm run build && cargo build --release -p logviewer-dev && npm run test:ui
//
// Starts the dev server on a throwaway library, imports the logs in testdata/logs through the UI and walks the main flows.
// Set CHROME=/path/to/chrome to use a browser Playwright did not download. Pass a directory to save screenshots there.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const port = 1439;
const tmp = mkdtempSync(join(tmpdir(), 'logviewer-test-'));
const bin = join(root, 'target', 'release', process.platform === 'win32' ? 'logviewer-dev.exe' : 'logviewer-dev');
if (!existsSync(bin)) throw new Error('Build the dev server first: cargo build --release -p logviewer-dev');
if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Build the UI first: npm run build');
const logs = readdirSync(join(root, 'testdata', 'logs'))
  .filter(f => f.endsWith('.csv'))
  .sort()
  .map(f => join(root, 'testdata', 'logs', f));

const url = 'http://127.0.0.1:' + port + '/';
// a server left over from an earlier run would answer in place of the one started here, with its old library and old core
const portInUse = await fetch(url).then(
  () => true,
  () => false,
);
if (portInUse) throw new Error('Port ' + port + ' is in use. Stop the process listening on it, then run the test again.');
const server = spawn(bin, ['--port', String(port), '--dir', join(tmp, 'library'), '--dist', join(root, 'dist')], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try {
    await (await fetch(url)).text();
    break;
  } catch {
    await new Promise(r => setTimeout(r, 100));
  }
}

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};

let browser;
try {
  // inside the try: a browser that fails to start must not leave the server running
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [];
  const open = async (opts = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, ...opts });
    page.on('pageerror', e => errors.push(e.message));
    // a refused import is an HTTP 400 from the dev server, which the browser reports on the console; that is expected here
    page.on('console', m => m.type() === 'error' && !/status of 400/.test(m.text()) && errors.push(m.text()));
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('sub').textContent !== 'Opening the library');
    return page;
  };
  const text = (page, id) => page.evaluate(i => document.getElementById(i).textContent, id);
  const shot = async (page, name, full = false) => shots && (await page.screenshot({ path: join(shots, name + '.png'), fullPage: full }));
  const settle = page => page.waitForTimeout(250);

  // empty library
  let page = await open();
  check('empty library says so', (await text(page, 'sub')) === 'No logs yet' && (await page.locator('#logs .empty').count()) === 1);
  await shot(page, '01-empty');

  // import through the file input: one file that is not a log, then real logs
  await page.setInputFiles('#file', [{ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') }]);
  await page.waitForFunction(() => /notes\.csv: /.test(document.getElementById('status').textContent));
  check(
    'a CSV that is not an NSP log is refused with a reason',
    /notes\.csv: /.test(await text(page, 'status')),
    await text(page, 'status'),
  );
  await page.setInputFiles('#file', logs);
  await page.waitForFunction(n => document.querySelectorAll('#logs .log').length === n, logs.length, { timeout: 30000 });
  await settle(page);
  check('all logs imported', /^Added 8 logs, 10 new pulls\./.test(await text(page, 'status')), await text(page, 'status'));
  check(
    'header counts',
    /8 logs · 509 channels · 7,469 samples at 21 Hz · 10 pulls · E63/.test(await text(page, 'sub')),
    await text(page, 'sub'),
  );

  // the same file again is refused, not duplicated
  await page.setInputFiles('#file', [logs[0]]);
  await page.waitForFunction(() => /already in the library/.test(document.getElementById('status').textContent));
  check('duplicate log refused', (await page.locator('#logs .log').count()) === 8);

  // power chart: default selection and numbers from the core, smoothed at the default level
  const stats = await page.locator('#stats').innerText();
  check(
    'run A and B selected with peaks',
    /Run A · 2nd gear · 2,551–5,959 rpm[\s\S]*164\s*whp[\s\S]*Run B · 2nd gear[\s\S]*169\s*whp/.test(stats),
    stats.replace(/\n/g, ' '),
  );
  check('smoothing starts at Medium', (await page.getAttribute('[data-smooth="med"]', 'aria-pressed')) === 'true');
  await shot(page, '02-loaded');

  // smoothing off is the curve as the core first computes it
  await page.click('[data-smooth="off"]');
  await page.waitForFunction(() => /165\s*whp/.test(document.getElementById('stats').innerText));
  const unsmoothed = await page.locator('#stats').innerText();
  check('smoothing off shows the unsmoothed peaks', /165\s*whp[\s\S]*173\s*whp/.test(unsmoothed), unsmoothed.replace(/\n/g, ' '));
  await page.click('[data-smooth="med"]');
  await page.waitForFunction(() => /164\s*whp/.test(document.getElementById('stats').innerText));

  // vehicle dialog: weight changes the estimate
  await page.click('#veh-btn');
  await page.fill('#v-driver', '340');
  await page.waitForFunction(() => /3,102 lb/.test(document.getElementById('veh-btn-txt').textContent));
  await settle(page);
  const heavier = await page.locator('#stats').innerText();
  check('heavier car reads more power', /17[4-9]\s*whp/.test(heavier.split('Run B')[0]), heavier.split('Run B')[0].replace(/\n/g, ' '));
  check(
    'gearing check shown',
    /gearing gives 11\.9\d km\/h per 1,000 rpm; the ECU logged 12\.0\d/.test(await text(page, 'veh-sum')),
    await text(page, 'veh-sum'),
  );
  await shot(page, '03-vehicle');
  await page.fill('#v-driver', '140');
  await page.click('#veh-close');
  await settle(page);

  // overlay a third run
  await page.locator('.pull', { hasText: '3rd gear · 4,325' }).locator('button.r2').click();
  await page.waitForFunction(() => document.querySelectorAll('#stats .stat').length === 3);
  check('third run overlays', true);

  // findings: counts, explicit steps, and jumping to one shows its channels flagged
  check('finding summary', (await text(page, 'find-sum')) === '2 risk · 7 to check · 4 notes · 3 OK', await text(page, 'find-sum'));
  const lc = page.locator('.finding', { hasText: 'Launch control switches on at every stop' });
  check('launch control finding has steps', (await lc.locator('ol.steps li').count()) >= 2);
  await lc.locator('.acts button').first().click();
  await settle(page);
  const fv = await page.evaluate(() => {
    const s = window.__logViewer;
    return {
      title: s.fview && s.fview.title,
      keys: s.fview ? s.fview.keys : [],
      flagged: document.querySelectorAll('.ro.flag').length,
      sel: document.getElementById('view-sel').selectedOptions[0].textContent,
    };
  });
  check('finding view shows flagged channels', fv.keys.length > 0 && fv.flagged > 0 && /^Finding: /.test(fv.sel), JSON.stringify(fv));
  await shot(page, '04-finding', true);
  await page.click('#view-back');
  check(
    'back restores the working view',
    await page.evaluate(() => window.__logViewer.fview === null && document.querySelectorAll('.ro.flag').length === 0),
  );

  // fuel finding opens the fuel table as a grid
  const fuel = page.locator('.finding', { has: page.locator('button', { hasText: 'Open fuel table' }) }).first();
  await fuel.locator('summary').click();
  await fuel.locator('button', { hasText: 'Open fuel table' }).click();
  check(
    'fuel table opens as a grid',
    (await text(page, 'h-t3')) === 'Fuel table' &&
      (await page.locator('#t3-grid td').count()) > 50 &&
      /^[+−]?\d+$/.test((await page.locator('#t3-grid td:not(:empty)').first().textContent()) || ''),
  );
  await shot(page, '05-fuel-table');

  // channel picker, custom view, rename: all saved
  await page.click('#chan-btn');
  await page.fill('#pick-q', 'coolant temp');
  await page
    .locator('#pick-list .pk:not([hidden])', { has: page.locator('.nm[title="Coolant Temperature"]') })
    .locator('button', { hasText: 'Trace' })
    .click();
  await page.fill('#view-name', 'Warm-up');
  await page.click('#view-save');
  check('view saved', (await text(page, 'view-msg')) === 'Saved “Warm-up”.');
  await page.locator('.log-head', { hasText: '1:45 pm log' }).locator('button', { hasText: 'Rename' }).click();
  await page.keyboard.type('Back road');
  await page.keyboard.press('Enter');
  check('log renamed', (await page.locator('.log-head', { hasText: 'Back road' }).count()) === 1);

  // replay: playing moves the clock; by-RPM mode draws
  await page.locator('.pull', { hasText: '2,551–5,959' }).locator('button.r0').click();
  const t0 = await page.evaluate(() => window.__logViewer.t);
  await page.click('#play');
  await page.waitForTimeout(500);
  await page.click('#play');
  const t1 = await page.evaluate(() => window.__logViewer.t);
  check('play advances the replay', t1 > t0 + 0.2, (t1 - t0).toFixed(2) + ' s');
  await page.click('[data-xmode="rpm"]');
  await settle(page);
  check('by-RPM traces', /own RPM/.test(await text(page, 'tr-note')));
  await page.click('[data-xmode="time"]');
  await shot(page, '06-replay', true);
  await page.click('[data-smooth="high"]');
  await page.waitForTimeout(600); // settings are written a moment after the last change
  await page.close();

  // a new window gets everything back from the library on disk
  page = await open();
  await settle(page);
  const back = await page.evaluate(() => {
    const s = window.__logViewer;
    const smooth = document.querySelector('[data-smooth][aria-pressed="true"]')?.getAttribute('data-smooth');
    return { logs: s.logs.length, view: s.viewName, traces: s.rview.traces.map(t => t.a), named: Object.values(s.names.logs), smooth };
  });
  check(
    'library and settings persist',
    back.logs === 8 &&
      back.view === 'Warm-up' &&
      back.traces.includes('Coolant Temperature') &&
      back.named.includes('Back road') &&
      back.smooth === 'high',
    JSON.stringify(back),
  );

  // a saved smoothing level the app does not know falls back to Medium, also when it names something every object has
  await page.waitForTimeout(600); // let the write this page scheduled on opening finish first
  const saved = await (await fetch(url + 'api/get_settings', { method: 'POST', body: '{}' })).json();
  await fetch(url + 'api/set_settings', { method: 'POST', body: JSON.stringify({ value: { ...saved, smooth: 'constructor' } }) });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('sub').textContent !== 'Opening the library');
  await settle(page);
  const fallback = await page.evaluate(() => ({
    state: window.__logViewer.smooth,
    pressed: [...document.querySelectorAll('[data-smooth][aria-pressed="true"]')].map(b => b.getAttribute('data-smooth')),
  }));
  check(
    'unknown saved smoothing level falls back to Medium',
    fallback.state === 'med' && fallback.pressed.join() === 'med',
    JSON.stringify(fallback),
  );

  // watch folder (browser mode takes a typed path)
  const watch = join(tmp, 'incoming');
  mkdirSync(watch);
  await page.locator('.log-head', { hasText: '1:36 pm log' }).locator('button', { hasText: 'Remove' }).click();
  await page.locator('.log-head', { hasText: '1:36 pm log' }).locator('button', { hasText: 'Confirm' }).click();
  await page.waitForFunction(() => /^Removed PCLog_2026-04-17_0136pm\.csv/.test(document.getElementById('status').textContent));
  check('log removed', (await page.locator('#logs .log').count()) === 7);
  // the removed log is still in the folder: it must not come back. A duplicate and a non-log are passed over too.
  copyFileSync(logs[0], join(watch, 'PCLog_2026-04-17_0136pm.csv'));
  copyFileSync(logs[1], join(watch, 'duplicate-of-0140.csv'));
  copyFileSync(join(root, 'package.json'), join(watch, 'not-a-log.csv'));
  await page.fill('#watch-in', watch);
  await page.press('#watch-in', 'Enter');
  await page.waitForFunction(() => /watch folder/.test(document.getElementById('status').textContent));
  check(
    'watch folder leaves removed logs, duplicates and other CSVs alone',
    (await text(page, 'status')) === 'No new logs in the watch folder. ' && (await page.locator('#logs .log').count()) === 7,
    await text(page, 'status'),
  );
  copyFileSync(logs[0], join(watch, 'new-arrival.csv'));
  await page.click('#watch-scan');
  await page.waitForFunction(() => /^Added/.test(document.getElementById('status').textContent));
  check(
    'watch folder imports a new log',
    (await text(page, 'status')) === 'Added 1 log from the watch folder. ' && (await page.locator('#logs .log').count()) === 8,
    await text(page, 'status'),
  );
  await page.close();

  // phone and tablet widths, dark mode: no sideways scroll, rail not sticky on a phone
  for (const [name, width, height] of [
    ['phone', 390, 844],
    ['tablet', 1024, 1366],
  ]) {
    page = await open({ viewport: { width, height }, colorScheme: 'dark', hasTouch: true });
    await settle(page);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      rail: getComputedStyle(document.querySelector('.rail')).position,
    }));
    check(name + ' layout fits', m.sw <= m.cw && m.rail === (width < 860 ? 'static' : 'sticky'), JSON.stringify(m));
    await shot(page, '07-' + name, true);
    await page.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
