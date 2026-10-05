// End-to-end check of the UI against the real core, in a browser.
//
//   npm run build && cargo build --release -p logviewer-dev && npm run test:ui
//
// Starts the dev server on a throwaway library, imports the logs in testdata/logs through the UI and walks the main flows.
// Set CHROME=/path/to/chrome to use a browser Playwright did not download. Pass a directory to save screenshots there.

import { mkdirSync, copyFileSync, renameSync } from 'node:fs';
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

  // geometry of the trace canvas, as in src/charts.ts: TG for the traces and the band of ticks above the time axis
  const TG = { l: 46, r: 92, lab: 17, gap: 6, ticks: 12, axis: 22 };
  /** The replay as it stands: the span, the core's chips, the chips on screen and what they read, the canvas and its plot height. */
  const replay = page =>
    page.evaluate(TG => {
      const s = window.__logViewer;
      const traces = (s.fview || s.rview).traces.length;
      const height = document.getElementById('tr-wrap').offsetHeight;
      const chips = [...document.querySelectorAll('#chips .chip')];
      const name = c => c.querySelector('.nm').textContent;
      return {
        log: s.focus.log.name,
        w0: s.focus.w0,
        w1: s.focus.w1,
        chips: s.chips,
        names: chips.map(name).join(),
        now: chips.map(c => c.querySelector('.vl').textContent).join(),
        titles: chips.map(c => c.title),
        on: chips
          .filter(c => c.classList.contains('on'))
          .map(name)
          .join(),
        pressed: chips
          .filter(c => c.getAttribute('aria-pressed') === 'true')
          .map(name)
          .join(),
        traces,
        height,
        ph: (height - 4 - TG.axis - TG.ticks) / traces - TG.lab - TG.gap,
        note: document.getElementById('tr-note').textContent,
        pw: document.getElementById('tr-cv').clientWidth - TG.l - TG.r,
      };
    }, TG);
  /** x on the canvas of a time in the span; y of the top of trace k's plot; y of the time axis. */
  const xAt = (r, t) => TG.l + ((t - r.w0) / (r.w1 - r.w0)) * r.pw;
  const plotTop = (r, k) => k * (TG.lab + r.ph + TG.gap) + TG.lab;
  const axisY = r => r.traces * (TG.lab + r.ph + TG.gap) - TG.gap + TG.ticks;
  /** Put the playhead at t and redraw: pressing By time redraws and moves nothing. Returns what the chips read there. */
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
  const chipsShown = (page, n) => until(page, n => document.querySelectorAll('#chips .chip').length === n, n);
  /** Click the chip with this exact name. False when there is none. */
  const clickChip = async (page, name) => {
    const chip = page.locator('#chips .chip').filter({ has: page.getByText(name, { exact: true }) });
    if (!(await chip.count())) return false;
    await chip.first().click();
    return true;
  };
  // the chips of the default pull and of the whole Back road log (the 1:45 pm log, renamed below), as the core orders them
  const DEFAULT_CHIPS =
    'Decel Detected,Drive By Wire 1 Pin 1 Output State,Clutch State,Gear Upshift State,Stepper 1 Pin 2 Output State,Predicted MAP Active,' +
    'Drive By Wire Throttle Motor Direction,Engine State,Idle Control State,Ignition Active Table,Gear,Traction Control State,Manifold Pressure Filter Scale';
  const WHOLE_CHIPS =
    'Stepper 1 Pin 2 Output State,Predicted MAP Active,Drive By Wire 1 Pin 1 Output State,Clutch State,Decel Detected,Gear Upshift State,AVI1 Switch State,Brake Pedal State,' +
    'Manifold Pressure Filter Scale,Drive By Wire 1 Pin 2 Output State,Engine State,Ignition Active Table,Idle Control State,Gear,Start Button Next Expected Action Channel,Launch Control State';

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
  check('header line', (await text(page, 'sub')) === '8 logs · 10 pulls · E63 on the flex sensor', await text(page, 'sub'));
  // a log is named by its date and time, from the core; the year is added when it is not this year
  const logDay = 'Apr 17' + (new Date().getFullYear() === 2026 ? '' : ', 2026');
  const logAt = time => logDay + ', ' + time;
  /** Click one of a log's own buttons (Replay, Rename, Remove, Confirm), the log known by text in it. False when there is no such button. */
  const logAction = async (title, label) => {
    const b = page.locator('#logs .log', { hasText: title }).locator('.links button', { hasText: label });
    if (!(await b.count())) return false;
    await b.first().click();
    return true;
  };
  const titleList = p =>
    p.evaluate(() => [...document.querySelectorAll('#logs .log')].map(l => l.querySelector('.ttl').textContent).join(' | '));
  check(
    'each log is titled by its date and time, oldest first',
    (await titleList(page)) ===
      ['1:36 pm', '1:40 pm', '1:42 pm', '1:44 pm', '1:45 pm', '1:46 pm', '1:48 pm', '1:55 pm'].map(logAt).join(' | '),
    await titleList(page),
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
  const runLine = await page.evaluate(
    () =>
      [...document.querySelectorAll('#stats .who')].map(w => w.textContent).join(' | ') +
      ' | ' +
      document.getElementById('replay-what').textContent,
  );
  check(
    'the run lines and the replay name the log by its date and time',
    runLine ===
      'Run A · 2nd gear · 2,551–5,959 rpm · ' +
        logAt('1:45 pm') +
        ' | Run B · 2nd gear · 2,689–5,662 rpm · ' +
        logAt('1:45 pm') +
        ' | 2nd gear · 2,551–5,959 rpm · ' +
        logAt('1:45 pm'),
    runLine,
  );
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
  // findings keep their column when one opens or closes
  await page.locator('#find-all .finding summary').first().scrollIntoViewIfNeeded();
  const columns = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#find-all .finding')]
        .map(f => {
          const c = f.closest('.fcol');
          return (c ? [...c.parentElement.children].indexOf(c) : -1) + ':' + Math.round(f.getBoundingClientRect().left);
        })
        .join(),
    );
  const secondTop = () =>
    page.evaluate(() => {
      const f = document.querySelector('#find-all .fcol:nth-child(2) .finding');
      return f ? Math.round(f.getBoundingClientRect().top + scrollY) : -1;
    });
  const colsBefore = await columns();
  const topBefore = await secondTop();
  await page.locator('#find-all .finding summary').first().click();
  const colsAfter = await columns();
  const topAfter = await secondTop();
  await page.locator('#find-all .finding summary').first().click();
  check(
    'findings keep their column when one closes',
    (await page.locator('#find-all .fcol').count()) === 2 && colsBefore === colsAfter && topBefore === topAfter && topBefore > 0,
    JSON.stringify([colsBefore, colsAfter, topBefore, topAfter]),
  );
  const a11y = await page.evaluate(() => ({
    mains: document.querySelectorAll('main').length,
    chart: document.getElementById('dyno-cv').getAttribute('aria-label'),
  }));
  check(
    'the work column is the main landmark, and the chart says where its values are',
    a11y.mains === 1 && a11y.chart.endsWith('The Table button shows the values.'),
    JSON.stringify(a11y),
  );
  const lc = page.locator('.finding', { hasText: 'Launch control switches on at every stop' });
  check('launch control finding has steps', (await lc.locator('ol.steps li').count()) >= 2);
  const occButtons = (await lc.locator('.acts button').allTextContents()).join(' | ');
  check(
    "a finding's occurrences name each log by its date and time",
    occButtons ===
      [
        '593 rpm, ' + logAt('1:55 pm') + ' 50 s',
        '688 rpm, ' + logAt('1:48 pm') + ' 28 s',
        '711 rpm, ' + logAt('1:55 pm') + ' 62 s',
        '754 rpm, ' + logAt('1:55 pm') + ' 57 s',
        '802 rpm, ' + logAt('1:45 pm') + ' 23 s',
        '811 rpm, ' + logAt('1:45 pm') + ' 16 s',
      ].join(' | '),
    occButtons,
  );
  await lc.locator('.acts button').first().click();
  await settle(page);
  const fv = await page.evaluate(() => {
    const s = window.__logViewer;
    return {
      title: s.fview && s.fview.title,
      keys: s.fview ? s.fview.keys : [],
      cards: document.querySelectorAll('#readouts .ro').length,
      cardRow: !document.getElementById('readouts').hidden,
      sel: document.getElementById('view-sel').selectedOptions[0].textContent,
    };
  });
  // every readout of a finding's view has a trace, so there is no card row; the flags are on the traces
  check(
    'finding view shows its flagged channels as traces, with no card row',
    fv.keys.length > 0 && fv.cards === 0 && !fv.cardRow && /^Finding: /.test(fv.sel),
    JSON.stringify(fv),
  );
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
  // renaming starts from the date and time; leaving it as it is keeps no name
  await logAction(logAt('1:44 pm'), 'Rename');
  const renameStart = await page.evaluate(() => document.querySelector('#logs input.rename')?.value ?? null);
  await page.keyboard.press('Enter');
  const keptName = await page.evaluate(
    () => Object.keys(window.__logViewer.names.logs).filter(k => k.startsWith('PCLog_2026-04-17_0144pm')).length,
  );
  check(
    'renaming starts from the date and time, and leaving it keeps no name',
    renameStart === logAt('1:44 pm') && keptName === 0,
    JSON.stringify([renameStart, keptName]),
  );
  await logAction(logAt('1:45 pm'), 'Rename');
  await page.keyboard.type('Back road');
  await page.keyboard.press('Enter');
  check('log renamed', (await page.locator('#logs .log .ttl', { hasText: 'Back road' }).count()) === 1);

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

  // switch and state chips. Channels is closed for these checks: with it closed the replay fits the window at every span below
  if (await page.isVisible('#picker')) await page.click('#chan-btn');
  // the 1:42 pm log has no switch that changes, and one state that does
  await logAction(logAt('1:42 pm'), 'Replay');
  await chipsShown(page, 1);
  const bare = await replay(page);
  check(
    'a log with a state and no switch shows a chip for the state',
    bare.names === 'Idle Control State' && !/ more /.test(bare.note),
    bare.names + ' | ' + bare.note,
  );
  // chips put in by hand for the same span, so that every case is on screen: on, off, no samples, a state, chips left out
  const putChips = (swMore, stMore) =>
    page.evaluate(
      ([swMore, stMore]) => {
        const s = window.__logViewer;
        const end = s.focus.w1;
        s.chips = {
          switches: {
            rows: [
              // the second on span is 10 ms of an 18 s span
              {
                name: 'Clutch',
                also: ['Clutch Input', 'AVI6'],
                on: [
                  [4, 8],
                  [14, 14.01],
                ],
                gaps: [[10, 12]],
                changes: [4, 8, 14, 14.01],
              },
              { name: 'Fan', also: [], on: [[0, end]], gaps: [], changes: [0] },
            ],
            more: swMore,
          },
          states: {
            // the last section starts on the last sample of the span and has no length
            rows: [
              {
                name: 'Gear',
                sections: [
                  [0, 5, 1],
                  [5, 9, 2],
                  [9, end, -1],
                  [end, end, 4],
                ],
                gaps: [[15, 16]],
                changes: [5, 9, end],
              },
            ],
            more: stMore,
          },
        };
        s.rev++; // they are for the span on screen: chipsFor already names it
      },
      [swMore, stMore],
    );
  await putChips(2, 1);
  const read = [
    await playhead(page, 2),
    await playhead(page, 6),
    await playhead(page, 11),
    await playhead(page, 15.5),
    await playhead(page, bare.w1),
  ].join(' | ');
  check(
    'a chip reads On or Off, a state its value, a dash where there are no samples, and at the end of the span its last section',
    read === 'Off,On,1 | On,On,2 | –,On,-1 | Off,On,– | Off,On,4',
    read,
  );
  let drawn = await replay(page);
  check(
    'a switch chip has a dot that is filled while it is on, and its other names in its title',
    drawn.names === 'Clutch,Fan,Gear' && drawn.on === 'Fan' && drawn.titles.join('|') === 'Also logged as Clutch Input, AVI6||',
    JSON.stringify([drawn.names, drawn.on, drawn.titles]),
  );
  check('the note counts the chips left out', / 3 more change in this span and are not shown\.$/.test(drawn.note), drawn.note);
  await putChips(1, 0);
  await playhead(page, 6);
  drawn = await replay(page);
  check('and counts one as one', / 1 more changes in this span and is not shown\.$/.test(drawn.note), drawn.note);
  check('the trace canvas keeps its height with chips', drawn.height === bare.height, bare.height + ' -> ' + drawn.height);
  await shot(page, '06b-chips', true);
  // the rows under the traces are gone: pointing under the last trace shows the values tooltip, nothing about a switch
  await page.locator('#tr-cv').hover({ position: { x: xAt(drawn, 6), y: axisY(drawn) - 4 } });
  const tip = await page.evaluate(() => (document.getElementById('tip').hidden ? '' : document.getElementById('tip').innerText));
  const rowState = await page.evaluate(() => ['sw', 'swNow', 'swHover'].filter(k => k in window.__logViewer).join());
  await page.mouse.move(0, 0);
  check(
    'no switch rows, and no tooltip of their own',
    rowState === '' && /^\d+\.\d\d s\n/.test(tip) && !/Also logged as/.test(tip),
    JSON.stringify([rowState, tip]),
  );
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.chips = null;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  drawn = await replay(page);
  check(
    'with no chips none are shown, and the traces keep their height',
    drawn.names === '' && drawn.height === bare.height,
    String(drawn.height),
  );

  // chips from the core. The default pull is run A already, so make another pull run A and come back: that focuses it.
  const asked = [];
  page.on('request', q => /\/api\/chips$/.test(q.url()) && asked.push(JSON.parse(q.postData())));
  await page.locator('.pull', { hasText: '3rd gear · 2,974' }).locator('button.r0').click();
  await until(page, () => window.__logViewer.chips !== null);
  await page.locator('.pull', { hasText: '2,551–5,959' }).locator('button.r0').click();
  await chipsShown(page, 13);
  let pull = await replay(page);
  check(
    'the default pull shows its switches, then its states, each in order of first change',
    pull.names === DEFAULT_CHIPS && pull.height === bare.height,
    pull.names + ' ' + pull.height,
  );
  check('and leaves none out, so the note says nothing about them', !/ more /.test(pull.note), pull.note);
  check(
    'a switch logged under other names carries them in its title',
    pull.titles[2] === 'Also logged as AVI6 Switch State, Clutch Switch Input State' &&
      pull.titles[4] === 'Also logged as Cam Control Switched Output State Intake',
    JSON.stringify(pull.titles),
  );
  const chipInk = await textContrast(page, '#chips .chip');
  check('the text of every chip reads on it', chipInk.length === 13 && chipInk[0] >= 4.5, JSON.stringify(chipInk));
  const two = [await playhead(page, 30.3), await playhead(page, 33)];
  check(
    'the chips read the playhead',
    two[0] === 'On,Off,On,Off,Off,Off,1,2,-3,2,1,0,1' && two[1] === 'Off,On,Off,Off,On,Off,2,3,-7,0,2,0,1',
    two.join(' | '),
  );
  await shot(page, '06c-chips-pull', true);
  // a chip flips while the replay plays: the cam output, the fifth chip, comes on at 32.579 s
  const before = (await playhead(page, 32.4)).split(',')[4];
  await page.click('#play');
  const flipped = await until(page, () => document.querySelectorAll('#chips .chip .vl')[4]?.textContent === 'On');
  await page.click('#play');
  check('a chip flips while the replay plays', before === 'Off' && flipped, JSON.stringify([before, flipped]));
  check(
    'the chips are asked for once for each span, not on every frame',
    asked.length === 2 && asked[1].t0 === pull.w0 && asked[1].t1 === pull.w1,
    JSON.stringify(asked),
  );
  await page.click('[data-xmode="rpm"]');
  const byRpm = await replay(page);
  await page.click('[data-xmode="time"]');
  pull = await replay(page);
  check(
    'By RPM: the chips still read at the playhead, and nothing is asked again',
    byRpm.names === DEFAULT_CHIPS && byRpm.now === pull.now && byRpm.height === bare.height && asked.length === 2,
    JSON.stringify([byRpm.now, pull.now, byRpm.height, asked.length]),
  );
  /** How many pixels of one row of the plot area differ from the panel behind the canvas. */
  const marked = (page, y, r) =>
    page.evaluate(
      ([y, l, pw]) => {
        const d = document.getElementById('tr-cv').getContext('2d').getImageData(l, y, pw, 1).data;
        const s = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim().slice(1);
        const bg = [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          // the canvas is clear where nothing is drawn and the panel behind it is --surface: take each pixel as it looks over the panel
          const a = d[i + 3] / 255;
          const off = k => Math.abs(d[i + k] * a + bg[k] * (1 - a) - bg[k]);
          if (off(0) + off(1) + off(2) > 6) n++;
        }
        return n;
      },
      [Math.round(y), TG.l, Math.round(r.pw)],
    );
  // choosing a chip: it is shaded behind every trace in a tint of run A with an edge at each change, and its ticks are darker and taller
  const [ink, ink3, runA] = [await token(page, '--ink'), await token(page, '--ink-3'), await token(page, '--run-a')];
  const tinted = p => p[2] - p[0] >= 10; // blue over red: run A's tint, not the grey of the selected pull
  const chosen = () => page.evaluate(() => window.__logViewer.chosen);
  await playhead(page, 36.2); // clear of every pixel read below
  const choseClutch = await clickChip(page, 'Clutch State');
  pull = await replay(page);
  const top0 = plotTop(pull, 0) + 2; // in the first plot, under its top line and above anything written in it
  const ax = axisY(pull);
  const clutchMarks = {
    pressed: pull.pressed,
    chosen: await chosen(),
    on: tinted(await pixel(page, xAt(pull, 30.5), top0)),
    off: tinted(await pixel(page, xAt(pull, 33), top0)),
    edge: sameColour(await pixel(page, xAt(pull, 29.963), top0), runA),
    tall: sameColour(await pixel(page, xAt(pull, 31.206), ax - 6), ink),
    short: sameColour(await pixel(page, xAt(pull, 31.251), ax - 6), ink),
    tick: sameColour(await pixel(page, xAt(pull, 31.251), ax - 2), ink3),
    ink: (await textContrast(page, '#chips .chip[aria-pressed="true"]'))[0] >= 4.5,
  };
  check(
    'choosing a switch chip shades where it is on, edges its changes and makes its ticks darker and taller',
    choseClutch &&
      clutchMarks.pressed === 'Clutch State' &&
      clutchMarks.chosen === 'Clutch State' &&
      clutchMarks.on &&
      !clutchMarks.off &&
      clutchMarks.edge &&
      clutchMarks.tall &&
      !clutchMarks.short &&
      clutchMarks.tick &&
      clutchMarks.ink,
    JSON.stringify(clutchMarks),
  );
  // the choice survives scrubbing and playing
  const cv = await page.locator('#tr-cv').boundingBox();
  await page.mouse.click(cv.x + xAt(pull, 34), cv.y + top0 + 10);
  await page.click('#play');
  await page.waitForTimeout(200);
  await page.click('#play');
  check('the choice survives scrubbing and playing', (await chosen()) === 'Clutch State', String(await chosen()));
  // a state chip: every other section is shaded, and each section's value is written at its start in the first trace
  // text drawn on canvases that are not in the page: the traces' cached layer, not the power chart or the table
  await page.evaluate(() => {
    window.__texts = [];
    window.__fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...rest) {
      if (!this.canvas.isConnected) window.__texts.push([String(t), Math.round(x), Math.round(y)]);
      return window.__fillText.call(this, t, x, y, ...rest);
    };
  });
  await clickChip(page, 'Gear');
  pull = await replay(page);
  const labels = await page.evaluate(
    y => [...new Set(window.__texts.filter(([, , ty]) => ty === y).map(([t]) => t))].join(),
    plotTop(pull, 0) + 3,
  );
  await page.evaluate(() => (CanvasRenderingContext2D.prototype.fillText = window.__fillText));
  const gearMarks = {
    pressed: pull.pressed,
    labels,
    second: tinted(await pixel(page, xAt(pull, 33), top0)),
    first: tinted(await pixel(page, xAt(pull, 30.5), top0)),
  };
  check(
    'choosing a state chip, one at a time, shades every other section and writes each value at its start',
    gearMarks.pressed === 'Gear' && gearMarks.labels === '1,2,3' && gearMarks.second && !gearMarks.first,
    JSON.stringify(gearMarks),
  );
  await clickChip(page, 'Gear');
  pull = await replay(page);
  const unchosen = {
    pressed: pull.pressed,
    chosen: await chosen(),
    shade: tinted(await pixel(page, xAt(pull, 33), top0)),
    tall: sameColour(await pixel(page, xAt(pull, 31.251), ax - 6), ink),
  };
  check(
    'choosing it again clears the shading and the dark ticks',
    unchosen.pressed === '' && unchosen.chosen === null && !unchosen.shade && !unchosen.tall,
    JSON.stringify(unchosen),
  );
  // By RPM: no ticks and no shading, and the choice is kept for By time
  await clickChip(page, 'Clutch State');
  await page.click('[data-xmode="rpm"]');
  const rpmMarks = { band: await marked(page, ax - 2, pull), plot: await marked(page, top0, pull), chosen: await chosen() };
  await page.click('[data-xmode="time"]');
  const timeBand = await marked(page, ax - 2, pull);
  check(
    'By RPM draws no ticks and no shading, and keeps the choice',
    rpmMarks.band <= 3 && rpmMarks.plot <= 3 && rpmMarks.chosen === 'Clutch State' && timeBand > 15,
    JSON.stringify([rpmMarks, timeBand]),
  );
  // the choice clears when its chip is no longer shown
  await page.evaluate(() => {
    const s = window.__logViewer;
    window.__answer = s.chips;
    s.chips = { ...s.chips, switches: { ...s.chips.switches, rows: s.chips.switches.rows.filter(r => r.name !== 'Clutch State') } };
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  const choiceAfter = await chosen();
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.chips = window.__answer;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  check('the choice clears when its chip is no longer shown', choiceAfter === null, String(choiceAfter));
  // stepping: Previous change and Next change move the playhead to a change of the chosen chip, or of any chip shown
  const stepTo = async id => {
    if (!(await page.locator('#' + id).count())) return null;
    await page.click('#' + id);
    return page.evaluate(() => window.__logViewer.t);
  };
  const disabled = id => page.evaluate(id => !!document.getElementById(id)?.disabled, id);
  const stepLabels = await page.evaluate(() => [...document.querySelectorAll('#step-prev,#step-next')].map(b => b.textContent).join());
  await playhead(page, 30.5);
  const anyChip = [await stepTo('step-next'), await stepTo('step-next')];
  await playhead(page, 33);
  anyChip.push(await stepTo('step-prev'));
  check(
    'with no chip chosen, the step buttons land on the changes of every chip, once where two change together',
    stepLabels === 'Previous change,Next change' && JSON.stringify(anyChip) === '[30.581,30.626,32.961]',
    JSON.stringify([stepLabels, anyChip]),
  );
  await clickChip(page, 'Clutch State');
  await playhead(page, 33);
  const clutchSteps = [await stepTo('step-next'), await stepTo('step-next'), await disabled('step-next'), await stepTo('step-prev')];
  await page.click('#play');
  await page.waitForTimeout(200);
  const stepped = await stepTo('step-prev');
  const playing = await page.evaluate(() => window.__logViewer.playing);
  await clickChip(page, 'Clutch State');
  check(
    'with a chip chosen they land on its changes, stop at its last, and stop the replay',
    JSON.stringify(clutchSteps) === '[34.96,35.777,true,34.96]' && stepped === 34.96 && playing === false,
    JSON.stringify([clutchSteps, stepped, playing]),
  );
  await clickChip(page, 'Stepper 1 Pin 2 Output State'); // still shown in the narrower span below
  // the chips follow the span on screen, whatever set it: narrow the span by hand and they are asked for again
  await page.evaluate(() => {
    const s = window.__logViewer;
    s.focus.w0 += 2;
    s.focus.w1 -= 2;
    s.rev++;
  });
  await page.click('[data-xmode="time"]');
  await chipsShown(page, 3);
  const narrow = await replay(page);
  check(
    'the chips follow the span on screen when it changes',
    asked.length === 3 &&
      asked[2].t0 === narrow.w0 &&
      asked[2].t1 === narrow.w1 &&
      narrow.names === 'Stepper 1 Pin 2 Output State,Predicted MAP Active,Traction Control State' &&
      !/ more /.test(narrow.note),
    JSON.stringify([asked.length, asked[2], narrow.names]),
  );
  check('the choice clears when the span on screen changes', (await chosen()) === null && narrow.pressed === '', String(await chosen()));
  // across the whole log the clutch channels part by a sample at a few changes; they are still one chip
  await logAction('Back road', 'Replay');
  await chipsShown(page, 16);
  const whole = await replay(page);
  check(
    'a whole log shows the clutch once among its switches, the states that change least, and counts the rest',
    whole.names === WHOLE_CHIPS && / 2 more change in this span and are not shown\.$/.test(whole.note) && whole.height === bare.height,
    whole.names + ' | ' + whole.note + ' | ' + whole.height,
  );

  // while the dyno call for a new run A is on its way, a hover redraws the traces: chips of the old span must not appear
  let release;
  const gate = new Promise(r => (release = r));
  // the core's answer for the new span is held too, so only chips of the old span could be on screen
  await page.route(/\/api\/(dyno|chips)$/, async route => {
    await gate;
    await route.continue().catch(() => {}); // unrouting below may have let it through already
  });
  await page.locator('.pull', { hasText: '3rd gear · 2,974' }).locator('button.r0').click();
  await page.hover('#tr-cv', { position: { x: 120, y: 20 } });
  await page.mouse.move(130, 30);
  const mid = await replay(page);
  check(
    'chips of the previous span are not shown while the new run is loading',
    mid.names === '' && mid.height === bare.height,
    JSON.stringify([mid.names, mid.height]),
  );
  release();
  await page.unroute(/\/api\/(dyno|chips)$/);
  await page.waitForTimeout(600);

  // an answer that arrives after the user has moved to another span must not be shown for that span
  let held = 0;
  await page.route('**/api/chips', async route => {
    if (!held++) await new Promise(r => setTimeout(r, 800));
    await route.continue();
  });
  await logAction(logAt('1:44 pm'), 'Replay');
  await logAction(logAt('1:42 pm'), 'Replay');
  await page.waitForTimeout(1200);
  await page.unroute('**/api/chips');
  const late = await replay(page);
  check(
    'chips that arrive late for another span are dropped',
    late.log === 'PCLog_2026-04-17_0142pm.csv' && late.names === 'Idle Control State',
    JSON.stringify([late.log, late.names]),
  );

  // the checkbox in Channels turns the chips off without asking the core
  await logAction('Back road', 'Replay');
  await chipsShown(page, 16);
  if (!(await page.isVisible('#picker'))) await page.click('#chan-btn');
  const askedBefore = asked.length;
  const box = page.locator('#pick-sw');
  const label = await page.evaluate(() => document.getElementById('pick-sw')?.parentElement.textContent.trim());
  if (await box.count()) await box.uncheck();
  const off = await replay(page);
  check(
    'the checkbox in Channels reads "Show switches and states that change" and turns the chips off',
    label === 'Show switches and states that change' &&
      off.chips === null &&
      off.names === '' &&
      (await page.isHidden('#chips')) &&
      asked.length === askedBefore,
    JSON.stringify([label, off.chips, off.names, asked.length - askedBefore]),
  );

  // a failed request says so in the message area; turning the setting off clears the message, and chips come back when it is on
  const errorsBefore = errors.length;
  await page.route('**/api/chips', route => route.abort(), { times: 1 });
  await box.check();
  const failShown = await until(page, () => /^Switches and states failed: /.test(document.getElementById('status').textContent));
  await box.uncheck();
  const clearedByOff = (await text(page, 'status')) === '';
  await box.check();
  const chipsBack = await chipsShown(page, 16);
  check(
    'a failed request says so, turning the setting off clears it, and the chips come back',
    failShown && clearedByOff && chipsBack,
    JSON.stringify([failShown, clearedByOff, chipsBack]),
  );
  // the browser reports the aborted request on the console; that one is expected
  errors.splice(errorsBefore, errors.length - errorsBefore, ...errors.slice(errorsBefore).filter(m => !/ERR_FAILED/.test(m)));
  // chips that arrive clear only their own failure: another message stays
  await page.evaluate(() => (document.getElementById('status').textContent = 'Added 1 log.'));
  await box.uncheck();
  await box.check();
  await chipsShown(page, 16);
  check('chips that arrive leave any other message alone', (await text(page, 'status')) === 'Added 1 log.', await text(page, 'status'));
  // Try again asks for the chips again
  await box.uncheck();
  const errorsBeforeRetry = errors.length;
  await page.route('**/api/chips', route => route.abort(), { times: 1 });
  await box.check();
  const failedAgain = await until(page, () => /^Switches and states failed: /.test(document.getElementById('status').textContent));
  const offered = await page.evaluate(() => {
    const b = document.getElementById('msg-act');
    return b && !b.hidden ? b.textContent : null;
  });
  if (offered) await page.click('#msg-act');
  const chipsAfterRetry = await chipsShown(page, 16);
  check(
    'Try again brings the chips back and clears the message',
    failedAgain && offered === 'Try again' && chipsAfterRetry && (await text(page, 'status')) === '',
    JSON.stringify([failedAgain, offered, chipsAfterRetry, await text(page, 'status')]),
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

  // the chips were turned off before the window closed: they stay off, and ticking the box brings them back
  const kept = await page.evaluate(() => ({
    box: document.getElementById('pick-sw')?.checked,
    chips: window.__logViewer.chips,
    shown: document.querySelectorAll('#chips .chip').length,
  }));
  check('chips stay off after a reload', kept.box === false && kept.chips === null && kept.shown === 0, JSON.stringify(kept));
  await page.click('#chan-btn');
  if (await page.locator('#pick-sw').count()) await page.check('#pick-sw');
  check('and come back when the box is ticked', await chipsShown(page, 13));
  // a switch added as a trace is drawn as a trace and keeps its chip
  const beforeTrace = await replay(page);
  await page.fill('#pick-q', 'clutch state');
  const clutchTrace = page
    .locator('#pick-list .pk:not([hidden])', { has: page.locator('.nm[title="Clutch State"]') })
    .locator('button', { hasText: 'Trace' });
  await clutchTrace.click();
  const both = await replay(page);
  check(
    'a switch added as a trace keeps its chip',
    both.traces === beforeTrace.traces + 1 && both.names === beforeTrace.names && both.names.split(',')[2] === 'Clutch State',
    JSON.stringify([both.traces, both.names]),
  );
  await clutchTrace.click();
  await page.fill('#pick-q', '');

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
  await logAction(logAt('1:36 pm'), 'Remove');
  await logAction(logAt('1:36 pm'), 'Confirm');
  await until(page, () => /^Removed PCLog_2026-04-17_0136pm\.csv/.test(document.getElementById('status').textContent));
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
  // a watch-folder failure the person has dismissed does not come back each time the window comes to the front,
  // and a scan that works clears one that is still on screen
  const goneDir = watch + '-gone';
  let ahead = 0;
  /** The window comes to the front, more than 5 s after the last scan: the app scans on its own. Resolves once the core has answered. */
  const toFront = async () => {
    const answered = page.waitForResponse(r => r.url().endsWith('/api/scan_dir'));
    await page.evaluate(
      ms => {
        const now = Date.now;
        Date.now = () => now() + ms;
        window.dispatchEvent(new Event('focus'));
        Date.now = now;
      },
      (ahead += 60000),
    );
    await (await answered).finished();
    await settle(page);
  };
  renameSync(watch, goneDir);
  await toFront();
  const scanFailure = await text(page, 'status');
  await page.click('#msg-x');
  await toFront();
  const afterDismiss = await text(page, 'status');
  check(
    'a watch-folder failure that was dismissed does not come back when the window comes to the front',
    /^Cannot read /.test(scanFailure) && afterDismiss === '',
    JSON.stringify([scanFailure, afterDismiss]),
  );
  // a scan the person asks for always says what happened
  await page.click('#watch-scan');
  await page.waitForFunction(() => /^Cannot read /.test(document.getElementById('status').textContent));
  renameSync(goneDir, watch);
  await toFront();
  check('a scan that works clears the watch-folder failure', (await text(page, 'status')) === '', await text(page, 'status'));
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
  check(
    'the Vehicle button is named by its text, so a screen reader hears the count',
    (await page.getByRole('button', { name: 'Vehicle · 2,902 lb · check 1 field', exact: true }).count()) === 1,
  );
  await page.waitForTimeout(600); // the settings written now hold the default again, for the pages below
  await page.close();

  // the date and time are read as the core wrote them: a machine in another zone and another year shows the same time, with the year
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, timezoneId: 'Pacific/Kiritimati' });
  await page.clock.setFixedTime(new Date('2027-03-01T12:00:00Z'));
  await page.goto(url);
  await libraryOpen(page);
  const zoned = (await titleList(page)).split(' | ');
  check(
    'in another zone and another year a log reads its own time, with the year',
    zoned.length === 8 && zoned[0] === 'Apr 17, 2026, 1:36 pm' && zoned.includes('Apr 17, 2026, 1:55 pm'),
    zoned.join(' | '),
  );
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
  // a control that recomputes, used before the saved settings arrive, must not throw: the vehicle's values are there from the start
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.addInitScript(() => {
    window.__early = [];
    addEventListener('unhandledrejection', e => window.__early.push(String(e.reason)));
    addEventListener('error', e => window.__early.push(e.message));
  });
  let letSettingsThrough;
  const settingsHeld = new Promise(r => (letSettingsThrough = r));
  await page.route('**/api/get_settings', async route => {
    await settingsHeld;
    await route.continue();
  });
  await page.goto(url);
  // a click made in the page: the control is wired before the settings are asked for
  await page.evaluate(() => document.querySelector('[data-smooth="off"]').click());
  await settle(page);
  const early = await page.evaluate(() => window.__early);
  letSettingsThrough();
  const openedAfterEarly = await until(page, () => document.getElementById('sub').textContent !== 'Opening the library');
  check(
    'a control used before the settings arrive does not throw',
    early.length === 0 && openedAfterEarly,
    JSON.stringify([early, openedAfterEarly]),
  );
  await page.close();
  // Reduce Motion: Replay on a log scrolls to the replay without animation
  for (const reducedMotion of ['reduce', 'no-preference']) {
    page = await open({ reducedMotion });
    await settle(page);
    const behavior = await page.evaluate(() => {
      let seen;
      const real = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (o) {
        seen = o && o.behavior;
        return real.call(this, o);
      };
      document.querySelector('#logs .links button').click();
      Element.prototype.scrollIntoView = real;
      return seen;
    });
    const want = reducedMotion === 'reduce' ? 'auto' : 'smooth';
    check('Replay scrolls with behavior ' + want + ' when Reduce Motion is ' + reducedMotion, behavior === want, String(behavior));
    await page.close();
  }
  // fitting the screen: with the default view and pull, the replay from the transport to the time axis fits the window,
  // with plots from 34 to 53 px; when it cannot, the page scrolls and the transport stays at the top of the window
  const fit = async (width, height, picker = false) => {
    page = await open({ viewport: { width, height } });
    await settle(page);
    await page.selectOption('#view-sel', 'Default');
    await chipsShown(page, 13);
    if (picker) await page.click('#chan-btn');
    await page.evaluate(() => document.getElementById('replay-panel').scrollIntoView({ block: 'start' }));
    await settle(page);
    const r = await replay(page);
    const span = await page.evaluate(() =>
      Math.round(
        document.getElementById('tr-wrap').getBoundingClientRect().bottom -
          document.querySelector('#replay-panel .transport').getBoundingClientRect().top,
      ),
    );
    const cards = await page.evaluate(() => [...document.querySelectorAll('#readouts .ro .lb')].map(e => e.textContent).join());
    await page.evaluate(() => document.getElementById('tr-wrap').scrollIntoView({ block: 'end' }));
    await settle(page);
    const play = await page.evaluate(() => {
      const b = document.getElementById('play').getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight;
    });
    await page.close();
    return { ph: r.ph, span, cards, play };
  };
  const at900 = await fit(1440, 900);
  check('at 1440 × 900 the replay fits from the transport to the time axis', at900.span <= 900 && at900.ph === 53, JSON.stringify(at900));
  check('a card only for a readout without a trace', at900.cards === 'Road speed,Boost,Est. wheel power,Est. torque', at900.cards);
  const at700 = await fit(1440, 700);
  check(
    'at 1440 × 700 the plots are shorter, not under 34 px, and the replay still fits',
    at700.ph < at900.ph && at700.ph >= 34 && at700.span <= 700,
    JSON.stringify(at700),
  );
  const tight = await fit(1440, 700, true);
  check(
    'when it cannot fit, the plots are 34 px and Play stays in the window as the page scrolls',
    tight.ph === 34 && tight.span > 700 && tight.play,
    JSON.stringify(tight),
  );
  // the fit follows the room: opening Channels takes room from the traces, and closing it gives the room back
  page = await open({ viewport: { width: 1440, height: 700 } });
  await settle(page);
  await page.selectOption('#view-sel', 'Default');
  await chipsShown(page, 13);
  await page.evaluate(() => document.getElementById('replay-panel').scrollIntoView({ block: 'start' }));
  await settle(page);
  const roomClosed = (await replay(page)).ph;
  await page.click('#chan-btn');
  await settle(page);
  const roomOpen = (await replay(page)).ph;
  await page.click('#chan-btn');
  await settle(page);
  const roomClosedAgain = (await replay(page)).ph;
  await page.close();
  check(
    'the plots give room to Channels when it opens and take it back when it closes',
    roomOpen < roomClosed && roomClosedAgain === roomClosed,
    JSON.stringify([roomClosed, roomOpen, roomClosedAgain]),
  );
  // a window that only gets shorter: no box above the traces changes size, so only the window's own resize refits
  page = await open({ viewport: { width: 1440, height: 900 } });
  await settle(page);
  await page.selectOption('#view-sel', 'Default');
  await chipsShown(page, 13);
  const tallWindow = (await replay(page)).ph;
  await page.setViewportSize({ width: 1440, height: 700 });
  await settle(page);
  const shortWindow = (await replay(page)).ph;
  await page.close();
  check(
    'the plots follow the window when only its height changes',
    tallWindow === at900.ph && shortWindow === at700.ph,
    JSON.stringify([tallWindow, shortWindow]),
  );

  // the end of a span goes to the core as text and comes back in the answer; it must be the same number to the bit, or a
  // switch that is on at the end of the span reads Off there. Narrow the span to each millisecond of a stretch where a
  // switch is on, put the playhead on the end and read the chip
  page = await open();
  await settle(page);
  await page.selectOption('#view-sel', 'Default');
  await chipsShown(page, 13);
  const spanEnds = await page.evaluate(async () => {
    const s = window.__logViewer;
    const redraw = () => document.querySelector('[data-xmode="time"]').click();
    // a switch that turns on inside the span and stays on for a quarter of a second or more
    const long = o => o[0] > s.focus.w0 && o[1] - o[0] >= 0.25;
    const row = s.chips.switches.rows.find(r => r.on.some(long));
    if (!row) return { name: '', tested: 0, wrong: [] };
    const [a, b] = row.on.find(long);
    const wrong = [];
    let tested = 0;
    for (let ms = Math.ceil(a * 1000) + 1; ms < b * 1000 && tested < 150; ms++) {
      const end = Math.fround(ms / 1000);
      s.focus.w1 = end;
      redraw();
      const key = [s.focus.log.key, s.focus.w0, end].join('|');
      for (let i = 0; i < 400 && s.chipsFor !== key; i++) await new Promise(r => setTimeout(r, 5));
      s.t = end;
      redraw();
      const chip = [...document.querySelectorAll('#chips .chip')].find(c => c.dataset.chip === row.name);
      const reads = chip ? chip.querySelector('.vl').textContent : 'no chip';
      tested++;
      if (reads !== 'On') wrong.push(end + ' ' + reads);
    }
    return { name: row.name, tested, wrong: wrong.slice(0, 5) };
  });
  await page.close();
  check(
    'a switch that is on at the end of the span reads On there, whatever millisecond the span ends on',
    spanEnds.tested >= 100 && spanEnds.wrong.length === 0,
    JSON.stringify(spanEnds),
  );

  // phone and tablet widths, dark mode: no sideways scroll, rail not sticky on a phone
  for (const [name, width, height] of [
    ['phone', 390, 844],
    ['tablet', 1024, 1366],
  ]) {
    page = await open({ viewport: { width, height }, colorScheme: 'dark', hasTouch: true });
    await settle(page);
    // the default pull is on screen with its chips
    await chipsShown(page, 13);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      rail: getComputedStyle(document.querySelector('.rail')).position,
      chips: document.querySelectorAll('#chips .chip').length,
    }));
    check(
      name + ' layout fits, chips included',
      m.sw <= m.cw && m.rail === (width < 860 ? 'static' : 'sticky') && m.chips === 13,
      JSON.stringify(m),
    );
    // on a touch screen a chip grows with the other buttons: all of them are in the stylesheet's touch block
    const touch = await page.evaluate(() => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      chip: Math.round(document.querySelector('#chips .chip').getBoundingClientRect().height),
      small: Math.round([...document.querySelectorAll('.btn.sm')].find(b => b.offsetParent).getBoundingClientRect().height),
    }));
    check(
      name + ': a chip is as tall as a small button on a touch screen',
      touch.coarse && touch.chip >= touch.small - 1,
      JSON.stringify(touch),
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
    if (name === 'phone') {
      const stacked = await page.evaluate(() => {
        const cols = [...document.querySelectorAll('#find-all .fcol')].map(c => c.getBoundingClientRect());
        return cols.length === 2 && Math.round(cols[0].left) === Math.round(cols[1].left) && cols[1].top >= cols[0].bottom;
      });
      check('on a phone the two columns of findings stack in order', stacked);
    }
    // the first Tab stop is the skip link, and it moves focus to the work column
    await page.keyboard.press('Tab');
    const skip = await page.evaluate(() => ({
      text: document.activeElement.textContent,
      shown: document.activeElement.getBoundingClientRect().top >= 0,
    }));
    if (skip.text === 'Skip to the charts and findings') await page.keyboard.press('Enter');
    const landed = await page.evaluate(() => document.activeElement.tagName + '#' + document.activeElement.id);
    check(
      name + ': the first Tab stop skips to the charts and findings',
      skip.text === 'Skip to the charts and findings' && skip.shown && landed === 'MAIN#main',
      JSON.stringify([skip, landed]),
    );
    await page.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  stop();
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
