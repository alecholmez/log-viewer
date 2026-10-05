// End-to-end check of the UI against the real core, in a browser.
//
//   npm run build && cargo build --release -p logviewer-dev && npm run test:ui
//
// Starts the dev server on a throwaway library, imports the logs in testdata/logs through the UI and walks the main flows.
// Set CHROME=/path/to/chrome to use a browser Playwright did not download. Pass a directory to save screenshots there.

import { mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { root, logs, startServer, libraryOpen, importLogs } from './server.mjs';

const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const { url, tmp, stop } = await startServer(1439);

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
    // WCAG contrast of two colours as the page reports them, "#rrggbb" or "rgb(r, g, b)", for the contrast checks
    await page.addInitScript(() => {
      const parse = c =>
        c[0] === '#'
          ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
          : c
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number);
      const lum = c => {
        const [r, g, b] = parse(c.trim()).map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      window.__contrast = (a, b) => {
        const x = lum(a) + 0.05;
        const y = lum(b) + 0.05;
        return x > y ? x / y : y / x;
      };
    });
    await page.goto(url);
    await libraryOpen(page);
    return page;
  };
  const text = (page, id) => page.evaluate(i => document.getElementById(i).textContent, id);
  const shot = async (page, name, full = false) => shots && (await page.screenshot({ path: join(shots, name + '.png'), fullPage: full }));
  const settle = page => page.waitForTimeout(250);
  /** Contrast of the text of each element a selector matches against that element's own background, lowest first. */
  const textContrast = (page, sel) =>
    page.evaluate(
      sel =>
        [...document.querySelectorAll(sel)]
          .map(e => +window.__contrast(getComputedStyle(e).color, getComputedStyle(e).backgroundColor).toFixed(2))
          .sort((a, b) => a - b),
      sel,
    );
  /** Contrast of a colour token against the panel colour. 0 when the token is not defined. */
  const tokenContrast = (page, name) =>
    page.evaluate(name => {
      const s = getComputedStyle(document.documentElement);
      const v = s.getPropertyValue(name).trim();
      return v ? +window.__contrast(v, s.getPropertyValue('--surface')).toFixed(2) : 0;
    }, name);

  // geometry of the trace canvas, as in src/charts.ts: TG for the traces, SW for the switch rows under them
  const TG = { l: 46, r: 92, lab: 17, ph: 53, gap: 6 };
  const SW = { top: 10, lab: 14, bar: 8, gap: 4 };
  const swPitch = SW.lab + SW.bar + SW.gap;
  /** The replay as it stands: the span, the switch rows and what they read, and where the canvas puts them. */
  const replay = page =>
    page.evaluate(
      ([l, r, pitch, gap]) => {
        const s = window.__logViewer;
        const traces = (s.fview || s.rview).traces.length;
        return {
          log: s.focus.log.name,
          w0: s.focus.w0,
          w1: s.focus.w1,
          rows: s.sw ? s.sw.rows : null,
          more: s.sw ? s.sw.more : null,
          now: (s.swNow || []).join(),
          height: document.getElementById('tr-wrap').offsetHeight,
          note: document.getElementById('tr-note').textContent,
          pw: document.getElementById('tr-cv').clientWidth - l - r,
          bandY: traces * pitch - gap,
        };
      },
      [TG.l, TG.r, TG.lab + TG.ph + TG.gap, TG.gap],
    );
  /** x on the canvas of a time in the span, and y of the middle of row k's bar. */
  const xAt = (r, t) => TG.l + ((t - r.w0) / (r.w1 - r.w0)) * r.pw;
  const barY = (r, k) => r.bandY + SW.top + k * swPitch + SW.lab + SW.bar / 2;
  /** Put the playhead at t and redraw: pressing By time redraws and moves nothing. Returns what the rows read there. */
  const playhead = async (page, t) => {
    await page.evaluate(t => (window.__logViewer.t = t), t);
    await page.click('[data-xmode="time"]');
    return (await replay(page)).now;
  };
  /** One pixel of the trace canvas, and a colour token from the stylesheet, both as [r, g, b, a]. */
  const pixel = (page, x, y) =>
    page.evaluate(
      ([x, y]) => [...document.getElementById('tr-cv').getContext('2d').getImageData(x, y, 1, 1).data],
      [Math.round(x), Math.round(y)],
    );
  const token = (page, name) =>
    page.evaluate(name => {
      const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim().slice(1);
      return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(255);
    }, name);
  const sameColour = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  /** Waits for a condition in the page. Answers false, with no exception, when it does not come true. */
  const until = (page, fn, arg) =>
    page.waitForFunction(fn, arg, { timeout: 5000 }).then(
      () => true,
      () => false,
    );
  const rowsShown = (page, n) => until(page, n => window.__logViewer.swNow?.length === n, n);

  // empty library
  let page = await open();
  check('empty library says so', (await text(page, 'sub')) === 'No logs yet' && (await page.locator('#logs .empty').count()) === 1);
  check(
    'empty library shows one panel that says how to start',
    (await page.isVisible('#start')) && !(await page.isVisible('#replay-panel')) && !(await page.isVisible('#dyno-wrap')),
  );
  const startAdd = page.locator('#start-add');
  const chooser = (await startAdd.count()) ? (await Promise.all([page.waitForEvent('filechooser'), startAdd.click()]))[0] : null;
  check('its button opens the file picker', chooser?.isMultiple() === true);
  await shot(page, '01-empty');

  // import through the file input: one file that is not a log, then real logs
  await page.setInputFiles('#file', [{ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') }]);
  await page.waitForFunction(() => /notes\.csv: /.test(document.getElementById('status').textContent));
  check(
    'a CSV that is not an NSP log is refused with a reason',
    /notes\.csv: /.test(await text(page, 'status')),
    await text(page, 'status'),
  );
  // the refusal is a failure: it is at the bottom of the window, not in the header, and stays until it is dismissed
  const refusal = await page.evaluate(() => {
    const m = document.getElementById('msg');
    if (!m) return { on: false };
    const r = m.getBoundingClientRect();
    return {
      on: m.classList.contains('on'),
      fail: m.classList.contains('fail'),
      atBottom: r.bottom <= innerHeight && r.top >= innerHeight - 140,
      dismiss: !document.getElementById('msg-x').hidden,
      inHeader: !!document.querySelector('header #status'),
    };
  });
  check(
    'a failure is shown at the bottom of the window with Dismiss',
    refusal.on && refusal.fail && refusal.atBottom && refusal.dismiss && !refusal.inHeader,
    JSON.stringify(refusal),
  );
  if (refusal.dismiss) await page.click('#msg-x');
  check(
    'Dismiss clears it',
    (await text(page, 'status')) === '' && !(await page.evaluate(() => document.getElementById('msg')?.classList.contains('on'))),
  );
  await importLogs(page);
  await settle(page);
  check('all logs imported', /^Added 8 logs, 10 new pulls\./.test(await text(page, 'status')), await text(page, 'status'));
  check('the start panel gives way to the charts', !(await page.isVisible('#start')) && (await page.isVisible('#replay-panel')));
  check(
    'header counts',
    /8 logs · 509 channels · 7,469 samples at 21 Hz · 10 pulls · E63/.test(await text(page, 'sub')),
    await text(page, 'sub'),
  );

  // the same file again is refused, not duplicated
  await page.setInputFiles('#file', [logs[0]]);
  await page.waitForFunction(() => /already in the library/.test(document.getElementById('status').textContent));
  check('duplicate log refused', (await page.locator('#logs .log').count()) === 8);
  const refused = await text(page, 'status');
  check('the refusal names the file once', refused.split('PCLog_2026-04-17_0136pm.csv').length === 2, refused);

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

  // a finding about the shape of the curve is marked on the chart, with the curve before smoothing drawn across it
  await page.locator('.pull', { hasText: '3rd gear · 2,974' }).locator('button.r0').click();
  await page.waitForFunction(() => /Torque dip at 3,257 rpm/.test(document.getElementById('legend').textContent));
  const dip = await page.evaluate(() => ({
    legend: document.getElementById('legend').textContent,
    pts: window.__logViewer.runFindings.find(f => f.dyno)?.dyno.pts.length ?? 0,
  }));
  check('torque dip is marked on the chart', /before smoothing/.test(dip.legend) && dip.pts > 3, JSON.stringify(dip));
  await shot(page, '02b-dip');
  await page.click('[data-smooth="off"]');
  await page.waitForFunction(() => !/before smoothing/.test(document.getElementById('legend').textContent));
  check('with smoothing off the mark stands alone', /Torque dip at 3,257 rpm/.test(await text(page, 'legend')), await text(page, 'legend'));
  await page.click('[data-smooth="med"]');
  await page.locator('.pull', { hasText: '2,551–5,959' }).locator('button.r0').click();
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
  // a value outside a field's range is not used: the field says what it takes, and the estimate keeps the last valid value
  await page.waitForFunction(() => document.getElementById('veh-btn-txt').textContent === 'Vehicle · 2,902 lb');
  await settle(page);
  const powerBefore = await page.locator('#stats').innerText();
  const field = () =>
    page.evaluate(() => {
      const i = document.getElementById('v-driver');
      return {
        hint: document.getElementById('v-driver-hint')?.textContent ?? null,
        invalid: i.getAttribute('aria-invalid'),
        describedBy: i.getAttribute('aria-describedby'),
        btn: document.getElementById('veh-btn-txt').textContent,
        lb: Math.round(window.__logViewer.veh.mass / 0.45359237),
      };
    });
  await page.fill('#v-driver', '2000');
  await settle(page);
  const typing = await field();
  check('no line under a field while it is being typed in', typing.hint === null && typing.lb === 2902, JSON.stringify(typing));
  await page.press('#v-driver', 'Tab');
  await settle(page);
  const left = await field();
  check(
    'an out-of-range value shows the range and is not used',
    left.hint === 'Enter 0 to 1,500. Using 140.' &&
      left.invalid === 'true' &&
      left.describedBy === 'v-driver-hint' &&
      left.btn === 'Vehicle · 2,902 lb · check 1 field' &&
      left.lb === 2902 &&
      (await page.locator('#stats').innerText()) === powerBefore,
    JSON.stringify(left),
  );
  await page.fill('#v-driver', '');
  await settle(page);
  const emptied = await field();
  check(
    'an empty field keeps the line and the last valid value',
    emptied.hint === 'Enter 0 to 1,500. Using 140.' && emptied.lb === 2902,
    JSON.stringify(emptied),
  );
  await page.fill('#v-driver', '140');
  await page.waitForFunction(() => document.getElementById('veh-btn-txt').textContent === 'Vehicle · 2,902 lb');
  const fixed = await field();
  check(
    'a valid value clears the line',
    fixed.hint === null && fixed.invalid === null && fixed.describedBy === null,
    JSON.stringify(fixed),
  );
  await page.click('#veh-close');
  await settle(page);

  // overlay a third run
  await page.locator('.pull', { hasText: '3rd gear · 4,325' }).locator('button.r2').click();
  await page.waitForFunction(() => document.querySelectorAll('#stats .stat').length === 3);
  check('third run overlays', true);

  // findings: counts, explicit steps, and jumping to one shows its channels flagged
  check('finding summary', (await text(page, 'find-sum')) === '2 risk · 7 to check · 4 notes · 3 OK', await text(page, 'find-sum'));
  // contrast: text is at least 4.5:1 on what it sits on, a line or a mark at least 3:1 on a panel
  const onRuns = await textContrast(page, '.ab button[aria-pressed="true"]');
  check('A, B and C read on their buttons', onRuns.length === 3 && onRuns[0] >= 4.5, JSON.stringify(onRuns));
  const onBadges = await textContrast(page, '.finding .ico');
  check('every badge reads', onBadges.length === 16 && onBadges[0] >= 4.5, JSON.stringify(onBadges));
  const tagGrey = await page.evaluate(() => {
    const t = document.querySelector('.finding .tag');
    return +window.__contrast(getComputedStyle(t).color, getComputedStyle(t.closest('.panel')).backgroundColor).toFixed(2);
  });
  check('the tag grey reads on a panel', tagGrey >= 4.5, String(tagGrey));
  const marks = [];
  for (const t of ['--run-a', '--run-b', '--run-c', '--warn-mark', '--crit']) marks.push(await tokenContrast(page, t));
  check('run colours and markers show on a panel', Math.min(...marks) >= 3, JSON.stringify(marks));
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
  // every number in a grid table reads on its cell; then back to the fuel grid, as the checks below expect
  const fuelCells = await textContrast(page, '#t3-grid td:not(:empty)');
  await page.click('[data-tmode="ign"]');
  await page.click('[data-tview="grid"]');
  const ignCells = await textContrast(page, '#t3-grid td:not(:empty)');
  check(
    'every number in the grid tables reads on its cell',
    fuelCells.length > 10 && fuelCells[0] >= 4.5 && ignCells.length > 40 && ignCells[0] >= 4.5,
    JSON.stringify([fuelCells[0], fuelCells.length, ignCells[0], ignCells.length]),
  );
  await page.click('[data-tview="3d"]');
  await page.click('[data-tmode="fuel"]');

  // channel picker, custom view, rename: all saved
  check(
    'naming and saving a view are inside the channel picker',
    !(await page.isVisible('#view-save')) && !(await page.isVisible('#view-name')),
  );
  await page.click('#chan-btn');
  check('and show once it is open', (await page.isVisible('#view-save')) && (await page.isVisible('#view-del')));
  await page.fill('#pick-q', 'coolant temp');
  await page
    .locator('#pick-list .pk:not([hidden])', { has: page.locator('.nm[title="Coolant Temperature"]') })
    .locator('button', { hasText: 'Trace' })
    .click();
  await page.fill('#view-name', 'Warm-up');
  await page.click('#view-save');
  check('view saved', (await text(page, 'view-msg')) === 'Saved “Warm-up”.');
  // saving over another view asks first; a name every object has, such as "constructor", is not taken for a saved view
  const viewState = () =>
    page.evaluate(() => {
      const s = window.__logViewer;
      return {
        views: Object.keys(s.views).sort().join(),
        view: s.viewName,
        traces: s.rview.traces.map(t => t.a),
        msg: document.getElementById('view-msg').textContent,
        btn: document.getElementById('view-save').textContent,
        status: document.getElementById('status').textContent,
        act: document.getElementById('msg-act').hidden ? null : document.getElementById('msg-act').textContent,
      };
    });
  await page.fill('#view-name', 'constructor');
  await page.click('#view-save');
  const plain = await viewState();
  check(
    'a name every object has saves without asking',
    plain.msg === 'Saved “constructor”.' && plain.view === 'constructor',
    JSON.stringify(plain),
  );
  await page.fill('#view-name', 'Warm-up');
  await page.click('#view-save');
  const replaceAsk = await viewState();
  check(
    'saving over another view asks first',
    replaceAsk.msg === 'A view called “Warm-up” exists. Replace it?' && replaceAsk.btn === 'Replace' && replaceAsk.view === 'constructor',
    JSON.stringify(replaceAsk),
  );
  await page.click('#view-save');
  const replaced = await viewState();
  check(
    'the second click replaces it',
    replaced.msg === 'Saved “Warm-up”.' && replaced.btn === 'Save view' && replaced.view === 'Warm-up',
    JSON.stringify(replaced),
  );
  // another message on that line withdraws the question: the button never says Replace beside it
  await page.fill('#view-name', 'constructor');
  await page.click('#view-save');
  const askedAgain = await viewState();
  await page.fill('#pick-q', 'coolant temp');
  await page
    .locator('#pick-list .pk:not([hidden])', { has: page.locator('.nm[title="Coolant Temperature"]') })
    .locator('button', { hasText: 'Trace' })
    .click();
  const withdrawn = await viewState();
  check(
    'a change to the view withdraws the question',
    askedAgain.btn === 'Replace' && withdrawn.msg === 'Unsaved changes' && withdrawn.btn === 'Save view',
    JSON.stringify([askedAgain.btn, withdrawn.msg, withdrawn.btn]),
  );
  // deleting a view can be undone
  await page.selectOption('#view-sel', 'constructor');
  await page.click('#view-del');
  const gone = await viewState();
  check(
    'deleting a view says so and offers Undo',
    gone.views === 'Warm-up' && gone.status === 'Deleted “constructor”.' && gone.act === 'Undo',
    JSON.stringify(gone),
  );
  if (gone.act === 'Undo') await page.click('#msg-act');
  const undone = await viewState();
  check(
    'Undo puts the view back and loads it',
    undone.views === 'Warm-up,constructor' && undone.view === 'constructor' && undone.traces.includes('Coolant Temperature'),
    JSON.stringify(undone),
  );
  // leave the library as the checks below expect it: Warm-up loaded, no other view
  if ((await page.inputValue('#view-sel')) === 'constructor') await page.click('#view-del');
  await page.selectOption('#view-sel', 'Warm-up');
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

  // switch rows, drawn from rows put in by hand so that every case is on screen: on, off, no samples, rows left out.
  // The 1:42 pm log has no switch that changes, so nothing else is drawn under its traces.
  await page.locator('.log-head', { hasText: '1:42 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await settle(page);
  const bare = await replay(page);
  // the core's own (empty) answer for this span says which span rows are for; hand-made rows are put in for that span
  await until(page, () => window.__logViewer.swFor !== '');
  const realFor = await page.evaluate(() => window.__logViewer.swFor);
  const putRows = more =>
    page.evaluate(
      ([more, realFor]) => {
        const s = window.__logViewer;
        s.sw = {
          rows: [
            {
              name: 'Clutch',
              also: ['Clutch Input'],
              // the second on span is 10 ms of an 18 s span: less than a pixel wide
              on: [
                [4, 8],
                [14, 14.01],
              ],
              gaps: [[10, 12]],
              changes: [4, 8, 14, 14.01],
            },
            { name: 'Fan', also: [], on: [[0, s.focus.w1]], gaps: [], changes: [] },
          ],
          more,
        };
        s.swFor = realFor; // the rows are for the span on screen
        s.rev++;
      },
      [more, realFor],
    );
  await putRows(2);
  const read = [await playhead(page, 2), await playhead(page, 6), await playhead(page, 11)].join(' | ');
  check('a switch row reads On, Off, or a dash where there are no samples', read === 'Off,On | On,On | –,On', read);
  await playhead(page, 15); // clear of the pixels read next
  let drawn = await replay(page);
  check(
    'two rows add their height under the traces',
    drawn.height === bare.height + SW.top + 2 * swPitch,
    bare.height + ' -> ' + drawn.height,
  );
  const [ink2, grid] = [await token(page, '--ink-2'), await token(page, '--grid')];
  const bar = [];
  for (const t of [6, 2, 11]) bar.push(await pixel(page, xAt(drawn, t), barY(drawn, 0)));
  check(
    'the bar is filled while the switch is on, plain while it is off and empty where there are no samples',
    sameColour(bar[0], ink2) && sameColour(bar[1], grid) && bar[2][3] === 0,
    JSON.stringify(bar),
  );
  const brief = await pixel(page, Math.floor(xAt(drawn, 14)), barY(drawn, 0));
  check('a switch that is on for one sample still shows', sameColour(brief, ink2), JSON.stringify(brief));
  check(
    'the note says how many switches are left out',
    / 2 more switches change in this span and are not shown\.$/.test(drawn.note),
    drawn.note,
  );
  await putRows(1);
  await playhead(page, 15);
  drawn = await replay(page);
  check('and counts one switch as one', / 1 more switch changes in this span and is not shown\.$/.test(drawn.note), drawn.note);
  await shot(page, '06b-switch-rows', true);
  await page.click('[data-xmode="rpm"]');
  drawn = await replay(page);
  check(
    'By RPM hides the rows and says so',
    drawn.height === bare.height && drawn.now === '' && / By RPM hides the switch rows\.$/.test(drawn.note),
    JSON.stringify([drawn.height, drawn.now, drawn.note]),
  );
  await page.click('[data-xmode="time"]');
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.sw = null;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  drawn = await replay(page);
  check('with no rows the traces take the height they had', drawn.height === bare.height && drawn.now === '', String(drawn.height));

  // switch rows from the core. The default pull is run A already, so make another pull run A and come back: that focuses it.
  const asked = [];
  page.on('request', q => /\/api\/switches$/.test(q.url()) && asked.push(JSON.parse(q.postData())));
  await page.locator('.pull', { hasText: '3rd gear · 2,974' }).locator('button.r0').click();
  // the rows put in by hand were taken out above, so rows here are the core's answer for that pull
  await until(page, () => window.__logViewer.sw !== null);
  await page.locator('.pull', { hasText: '2,551–5,959' }).locator('button.r0').click();
  await rowsShown(page, 6);
  let pull = await replay(page);
  const names = (pull.rows || []).map(r => r.name);
  check(
    'the default pull shows the switches that change in it, in order of first change',
    names.join() ===
      'Decel Detected,Drive By Wire 1 Pin 1 Output State,Clutch State,Gear Upshift State,Stepper 1 Pin 2 Output State,Predicted MAP Active' &&
      pull.height === bare.height + SW.top + 6 * swPitch,
    names.join() + ' ' + pull.height,
  );
  // the clutch is the third row; its second change is the pedal coming back up
  const up = pull.rows?.[2]?.changes[1] ?? 0;
  const flip = [await playhead(page, up - 0.1), await playhead(page, up + 0.1)].map(now => now.split(',')[2]);
  check('the readout flips as the playhead crosses a change', flip.join() === 'On,Off', flip.join());
  await shot(page, '06c-switch-rows-pull', true);
  await page.click('#play');
  await page.waitForTimeout(400);
  await page.click('#play');
  check(
    'the rows are asked for once for each span, not on every frame',
    asked.length === 2 && asked[1].t0 === pull.w0 && asked[1].t1 === pull.w1,
    JSON.stringify(asked),
  );
  await page.click('[data-xmode="rpm"]');
  const byRpm = await replay(page);
  await page.click('[data-xmode="time"]');
  pull = await replay(page);
  check(
    'By RPM hides them, and By time shows them again without asking again',
    byRpm.now === '' &&
      byRpm.height === bare.height &&
      / By RPM hides the switch rows\.$/.test(byRpm.note) &&
      pull.now.split(',').length === 6 &&
      asked.length === 2,
    JSON.stringify([byRpm.now, byRpm.height, byRpm.note, pull.now, asked.length]),
  );
  // the rows follow the span on screen, whatever set it: narrow the span by hand and they are asked for again
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.focus.w0 += 2;
    s.focus.w1 -= 2;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  await rowsShown(page, 2);
  const narrow = await replay(page);
  check(
    'the rows follow the span on screen when it changes',
    asked.length === 3 &&
      asked[2].t0 === narrow.w0 &&
      asked[2].t1 === narrow.w1 &&
      (narrow.rows || []).map(r => r.name).join() === 'Stepper 1 Pin 2 Output State,Predicted MAP Active',
    JSON.stringify([asked.length, asked[2], (narrow.rows || []).map(r => r.name)]),
  );
  // across the whole log the clutch channels part by a sample at a few changes; they are still one row
  await page.locator('.log-head', { hasText: 'Back road' }).locator('button', { hasText: 'Replay' }).click();
  await rowsShown(page, 8);
  const whole = await replay(page);
  const wholeNames = (whole.rows || []).map(r => r.name).join();
  check(
    'a whole log shows the clutch once among its eight rows, and no note when none is left out',
    wholeNames ===
      'Stepper 1 Pin 2 Output State,Predicted MAP Active,Drive By Wire 1 Pin 1 Output State,Clutch State,Decel Detected,Gear Upshift State,AVI1 Switch State,Brake Pedal State' &&
      whole.more === 0 &&
      !/ more switch/.test(whole.note),
    wholeNames + ' ' + whole.more + ' ' + whole.note,
  );

  // while the dyno call for a new run A is on its way, a hover redraws the traces: rows of the old span must not appear
  let release;
  const gate = new Promise(r => (release = r));
  // the core's answer for the new span is held too, so only rows of the old span could be on screen
  await page.route(/\/api\/(dyno|switches)$/, async route => {
    await gate;
    await route.continue().catch(() => {}); // unrouting below may have let it through already
  });
  await page.locator('.pull', { hasText: '3rd gear · 2,974' }).locator('button.r0').click();
  await page.hover('#tr-cv', { position: { x: 120, y: 20 } });
  await page.mouse.move(130, 30);
  const mid = await replay(page);
  check(
    'rows of the previous span are not drawn while the new run is loading',
    (mid.rows?.length ?? 0) === 0 && mid.now === '' && mid.height === bare.height,
    JSON.stringify([mid.rows?.length, mid.now, mid.height]),
  );
  release();
  await page.unroute(/\/api\/(dyno|switches)$/);
  await page.waitForTimeout(600);

  // an answer that arrives after the user has moved to another span must not be drawn against that span
  let held = 0;
  await page.route('**/api/switches', async route => {
    if (!held++) await new Promise(r => setTimeout(r, 800));
    await route.continue();
  });
  await page.locator('.log-head', { hasText: '1:44 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await page.locator('.log-head', { hasText: '1:42 pm log' }).locator('button', { hasText: 'Replay' }).click();
  await page.waitForTimeout(1200);
  await page.unroute('**/api/switches');
  const late = await replay(page);
  check(
    'rows that arrive late for another span are dropped',
    late.log === 'PCLog_2026-04-17_0142pm.csv' && late.rows?.length === 0 && late.height === bare.height,
    JSON.stringify([late.log, late.rows?.length, late.height]),
  );

  // the checkbox in Channels turns the rows off without asking the core
  await page.locator('.log-head', { hasText: 'Back road' }).locator('button', { hasText: 'Replay' }).click();
  await rowsShown(page, 8);
  const askedBefore = asked.length;
  const box = page.locator('#pick-sw');
  if (await box.count()) await box.uncheck();
  const off = await replay(page);
  check(
    'the checkbox in Channels turns the rows off',
    (await box.count()) === 1 && off.rows === null && off.now === '' && off.height === bare.height && asked.length === askedBefore,
    JSON.stringify([off.rows, off.now, off.height, asked.length - askedBefore]),
  );

  // a failed request says so in the message area; when rows come back for the span, the message goes
  const errorsBefore = errors.length;
  await page.route('**/api/switches', route => route.abort(), { times: 1 });
  await box.check();
  const failShown = await until(page, () => /^Switch rows failed: /.test(document.getElementById('status').textContent));
  // not asked again for the same span: unticking and ticking the box asks again
  await box.uncheck();
  await box.check();
  const rowsBack = await rowsShown(page, 8);
  const afterFail = await text(page, 'status');
  check(
    'a failed request says so, and the message goes when rows arrive',
    failShown && rowsBack && !/Switch rows failed/.test(afterFail),
    JSON.stringify([failShown, rowsBack, afterFail]),
  );
  // the browser reports the aborted request on the console; that one is expected
  errors.splice(errorsBefore, errors.length - errorsBefore, ...errors.slice(errorsBefore).filter(m => !/ERR_FAILED/.test(m)));
  // rows that arrive clear only their own failure: another message stays
  await page.evaluate(() => (document.getElementById('status').textContent = 'Added 1 log.'));
  await box.uncheck();
  await box.check();
  await rowsShown(page, 8);
  check('rows that arrive leave any other message alone', (await text(page, 'status')) === 'Added 1 log.', await text(page, 'status'));
  // Try again asks for the rows again
  await box.uncheck();
  const errorsBeforeRetry = errors.length;
  await page.route('**/api/switches', route => route.abort(), { times: 1 });
  await box.check();
  const failedAgain = await until(page, () => /^Switch rows failed: /.test(document.getElementById('status').textContent));
  const offered = await page.evaluate(() => {
    const b = document.getElementById('msg-act');
    return b && !b.hidden ? b.textContent : null;
  });
  if (offered) await page.click('#msg-act');
  const rowsAfterRetry = await rowsShown(page, 8);
  check(
    'Try again brings the rows back and clears the message',
    failedAgain && offered === 'Try again' && rowsAfterRetry && (await text(page, 'status')) === '',
    JSON.stringify([failedAgain, offered, rowsAfterRetry, await text(page, 'status')]),
  );
  errors.splice(
    errorsBeforeRetry,
    errors.length - errorsBeforeRetry,
    ...errors.slice(errorsBeforeRetry).filter(m => !/ERR_FAILED/.test(m)),
  );
  await box.uncheck();
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

  // the switch rows were turned off before the window closed: they stay off, and ticking the box brings them back
  const kept = await page.evaluate(() => ({
    box: document.getElementById('pick-sw')?.checked,
    rows: window.__logViewer.sw,
    now: window.__logViewer.swNow?.length,
  }));
  check('switch rows stay off after a reload', kept.box === false && kept.rows === null && kept.now === 0, JSON.stringify(kept));
  await page.click('#chan-btn');
  if (await page.locator('#pick-sw').count()) await page.check('#pick-sw');
  check('and come back when the box is ticked', await rowsShown(page, 6));
  // a switch added as a trace is drawn as a trace and keeps its row
  await page.fill('#pick-q', 'clutch state');
  const clutchTrace = page
    .locator('#pick-list .pk:not([hidden])', { has: page.locator('.nm[title="Clutch State"]') })
    .locator('button', { hasText: 'Trace' });
  await clutchTrace.click();
  const both = await replay(page);
  check(
    'a switch added as a trace keeps its row',
    both.height === bare.height + (TG.lab + TG.ph + TG.gap) + SW.top + 6 * swPitch && both.rows?.[2]?.name === 'Clutch State',
    both.height + ' ' + both.rows?.[2]?.name,
  );
  await clutchTrace.click();
  await page.fill('#pick-q', '');

  // pointing at a row: the other names of the switch in the tooltip, and a line through the traces at each of its changes
  const shown = await replay(page);
  const clutch = shown.rows?.[2];
  // one pixel under the top edge of the first trace: nothing else is drawn there
  const lineAt = t => pixel(page, xAt(shown, t), TG.lab + 1);
  const pointAt = y => page.locator('#tr-cv').hover({ position: { x: xAt(shown, shown.w0 + 3), y } });
  await pointAt(barY(shown, 2));
  const tip = await page.evaluate(() => (document.getElementById('tip').hidden ? '' : document.getElementById('tip').innerText));
  check(
    'pointing at a row lists the other names of the switch',
    /^Clutch State\s[\s\S]*Also logged as\s*AVI6 Switch State\s*Also logged as\s*Clutch Switch Input State/.test(tip),
    tip.replace(/\n/g, ' | '),
  );
  const lines = [];
  for (const t of clutch?.changes ?? []) lines.push(await lineAt(t));
  check(
    'and draws a line through the traces at each of its changes',
    lines.length === 4 && lines.every(p => sameColour(p, ink2)),
    JSON.stringify(lines),
  );
  // the upshift row changes 45 ms after the clutch does, six pixels along
  const other = await lineAt(shown.rows?.[3]?.changes[0] ?? 0);
  check('no other row draws its changes', !sameColour(other, ink2), JSON.stringify(other));
  await shot(page, '06d-switch-row-pointed');
  await pointAt(TG.lab + 20);
  const away = [await page.evaluate(() => window.__logViewer.swHover), await lineAt(clutch?.changes[0] ?? 0)];
  check('the lines go when the pointer moves up to the traces', away[0] === null && !sameColour(away[1], ink2), JSON.stringify(away));

  // a saved smoothing level or view name the app does not know falls back to the default, also when it names something every object has
  await page.waitForTimeout(600); // let the write this page scheduled on opening finish first
  const saved = await (await fetch(url + 'api/get_settings', { method: 'POST', body: '{}' })).json();
  await fetch(url + 'api/set_settings', {
    method: 'POST',
    body: JSON.stringify({ value: { ...saved, smooth: 'constructor', viewName: 'constructor' } }),
  });
  await page.reload();
  await libraryOpen(page);
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
  const fallbackView = await page.evaluate(() => ({
    state: window.__logViewer.viewName,
    chosen: document.getElementById('view-sel').value,
  }));
  check(
    'a saved view name that is not a saved view falls back to Default',
    fallbackView.state === 'Default' && fallbackView.chosen === 'Default',
    JSON.stringify(fallbackView),
  );
  // put back the view the checks before this one left loaded
  if (Object.hasOwn(saved.views ?? {}, saved.viewName)) await page.selectOption('#view-sel', saved.viewName);

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
  // a result stays in view when the page is scrolled to its end, and clears itself
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const inView = await page.evaluate(() => {
    const r = document.getElementById('msg')?.getBoundingClientRect();
    return !!r && r.bottom <= innerHeight && r.top >= innerHeight - 140;
  });
  const cleared = await page
    .waitForFunction(() => document.getElementById('status').textContent === '', null, { timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  check('a result stays in view when the page scrolls, and clears itself', inView && cleared, JSON.stringify([inView, cleared]));
  // a failure that replaces a result is not cleared by the result's clock
  await page.click('#watch-scan');
  await page.waitForFunction(() => /^No new logs/.test(document.getElementById('status').textContent));
  await page.setInputFiles('#file', [{ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') }]);
  await page.waitForFunction(() => /notes\.csv: /.test(document.getElementById('status').textContent));
  await page.waitForTimeout(6000);
  check(
    'a failure outlasts the clock of the result it replaced',
    /notes\.csv: /.test(await text(page, 'status')),
    await text(page, 'status'),
  );
  // a result that arrives while the pointer is on the message area waits for the pointer to leave
  await page.click('#msg-x');
  await page.click('#watch-scan');
  await page.waitForFunction(() => /^No new logs/.test(document.getElementById('status').textContent));
  await page.hover('#msg');
  // a second result arrives with the pointer still there: a click made in the page does not move the pointer
  await page.evaluate(() => document.getElementById('watch-scan').click());
  await page.waitForTimeout(5600);
  const heldText = await text(page, 'status');
  await page.mouse.move(5, 5);
  const releasedAndCleared = await page
    .waitForFunction(() => document.getElementById('status').textContent === '', null, { timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  check(
    'a result under the pointer stays, and clears once the pointer leaves',
    /^No new logs/.test(heldText) && releasedAndCleared,
    JSON.stringify([heldText, releasedAndCleared]),
  );
  // a button of the message area that is hidden while it has focus must not leave the clock held.
  // Stand in for an engine that sends no focusout for that: only a focusout that comes from blur() gets through.
  await page.setInputFiles('#file', [{ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') }]);
  await page.waitForFunction(() => /notes\.csv: /.test(document.getElementById('status').textContent));
  await page.evaluate(() => {
    let inBlur = false;
    const blur = HTMLElement.prototype.blur;
    HTMLElement.prototype.blur = function () {
      inBlur = true;
      try {
        blur.call(this);
      } finally {
        inBlur = false;
      }
    };
    addEventListener('focusout', e => !inBlur && e.stopImmediatePropagation(), true);
  });
  await page.focus('#msg-x');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('status').textContent === '');
  await page.evaluate(() => document.getElementById('watch-scan').click());
  await page.waitForFunction(() => /^No new logs/.test(document.getElementById('status').textContent));
  const clearedAfterKeyboardDismiss = await page
    .waitForFunction(() => document.getElementById('status').textContent === '', null, { timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  check('a result clears itself after Dismiss from the keyboard', clearedAfterKeyboardDismiss);
  await page.close();
  // a saved value that is out of range, as from a hand-edited settings file: shown with its line, and the default is used
  page = await open();
  await page.waitForTimeout(600); // let the page's own settings write finish first
  await page.evaluate(async () => {
    const st = await (await fetch('/api/get_settings', { method: 'POST', body: '{}' })).json();
    st.veh.curb = '80';
    await fetch('/api/set_settings', { method: 'POST', body: JSON.stringify({ value: st }) });
  });
  await page.reload();
  await libraryOpen(page);
  await page.waitForFunction(() => /^Vehicle · /.test(document.getElementById('veh-btn-txt').textContent));
  const atStart = await page.evaluate(() => ({
    value: document.getElementById('v-curb').value,
    hint: document.getElementById('v-curb-hint')?.textContent ?? null,
    btn: document.getElementById('veh-btn-txt').textContent,
    lb: Math.round(window.__logViewer.veh.mass / 0.45359237),
  }));
  check(
    'a saved value out of range is shown with its line, and the default is used',
    atStart.value === '80' &&
      atStart.hint === 'Enter 800 to 9,000. Using 2,762.' &&
      atStart.btn === 'Vehicle · 2,902 lb · check 1 field' &&
      atStart.lb === 2902,
    JSON.stringify(atStart),
  );
  await page.waitForTimeout(600); // the settings written now hold the default again, for the pages below
  await page.close();

  // the oldest webviews the app is built for (iOS 15.0, macOS 11) have no Object.hasOwn: it came with Safari 15.4
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const oldErrors = [];
  page.on('pageerror', e => oldErrors.push(e.message));
  await page.addInitScript(() => delete Object.hasOwn);
  await page.goto(url);
  const oldOpened = await until(page, () => document.getElementById('sub').textContent !== 'Opening the library');
  await settle(page);
  check('the app starts where Object.hasOwn does not exist', oldOpened && oldErrors.length === 0, JSON.stringify([oldOpened, oldErrors]));
  await page.close();
  // phone and tablet widths, dark mode: no sideways scroll, rail not sticky on a phone
  for (const [name, width, height] of [
    ['phone', 390, 844],
    ['tablet', 1024, 1366],
  ]) {
    page = await open({ viewport: { width, height }, colorScheme: 'dark', hasTouch: true });
    await settle(page);
    // the default pull is on screen with its six switch rows
    await rowsShown(page, 6);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      rail: getComputedStyle(document.querySelector('.rail')).position,
      rows: window.__logViewer.swNow?.length,
    }));
    check(
      name + ' layout fits, switch rows included',
      m.sw <= m.cw && m.rail === (width < 860 ? 'static' : 'sticky') && m.rows === 6,
      JSON.stringify(m),
    );
    const darkA = await textContrast(page, '.ab button.r0[aria-pressed="true"]');
    const darkNote = await textContrast(page, '.finding.info .ico');
    check(
      name + ' in the dark theme: A and the Note badge read',
      darkA.length === 1 && darkA[0] >= 4.5 && darkNote.length === 4 && darkNote[0] >= 4.5,
      JSON.stringify([darkA, darkNote]),
    );
    if (name === 'phone') {
      // the dark theme can also be chosen by attribute: that block must carry the same tokens as the system one
      const names = ['--ink-3', '--note', '--run-a', '--run-c', '--on-run-a', '--on-note', '--warn-mark'];
      const read = () =>
        page.evaluate(ns => {
          const s = getComputedStyle(document.documentElement);
          return ns.map(n => s.getPropertyValue(n).trim()).join();
        }, names);
      const bySystem = await read();
      // with the system light, only the attribute block can supply the dark values
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
      const byAttribute = await read();
      await page.evaluate(() => delete document.documentElement.dataset.theme);
      await page.emulateMedia({ colorScheme: 'dark' });
      check(
        'both dark theme blocks carry the same tokens',
        bySystem === byAttribute && bySystem === '#8b8e96,#8b8e96,#3987e5,#199e70,#060606,#060606,#fab219',
        bySystem + ' | ' + byAttribute,
      );
    }
    await shot(page, '07-' + name, true);
    await page.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  stop();
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
