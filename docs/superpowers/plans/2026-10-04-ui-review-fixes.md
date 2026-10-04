# UI Review First Fixes Implementation Plan

> **For agentic workers:** Execute this plan with the `convergence-loop` skill, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build step 1 of the UI review: colours that meet the contrast minimums, one message area at the bottom of the window, vehicle fields that refuse values outside their range, undo for a deleted view, findings that keep their column, and five small accessibility and copy fixes.

**Architecture:** Everything is in the TypeScript and CSS of the UI; the core is not touched. Colours change in the token blocks of `src/styles.css` and are read by the canvases through `theme()` in `src/state.ts`. Messages move from a line in the header to a new module, `src/messages.ts`, that owns one fixed element and its clock. The vehicle form keeps the last valid text of each field and the estimate reads that.

**Tech Stack:** TypeScript (ES2022, no framework), CSS custom properties, Vite, Playwright for the end-to-end test in `tests/ui.mjs` against the real core over HTTP.

**Spec:** `docs/superpowers/specs/2026-10-04-ui-review-fixes-design.md`

## Global Constraints

- Nothing under `crates/` or `src-tauri/` changes. Never refresh `crates/core/tests/golden.json` and never run with `UPDATE_GOLDEN=1`.
- No new dependency. No framework.
- The UI formats and draws; it does not analyse. Nothing here changes a number the core computes.
- The red (`--crit`) is the redline and risk in findings only. It is not used for a message, a failed request or an invalid field.
- Text is at least 4.5:1 against what it sits on; a line or a mark on a chart is at least 3:1 (WCAG formula).
- No rule in `src/styles.css` outside the token blocks at its top carries a raw colour.
- UI copy is minimal and direct, no metaphors. Use the strings in this plan exactly, including the curly quotes in `“Idle”`.
- Token values, exactly: light `--ink-3:#686b73`, `--note:#686b73`, `--run-a:#2875d2`, `--run-c:#159c6c`, `--warn-mark:#b87f00`; dark `--ink-3:#8b8e96`, `--note:#8b8e96`, `--warn-mark:#fab219`; both `--on-fill-light:#ffffff`, `--on-fill-dark:#060606`, `--backdrop:rgb(8 10 14 / .5)`.
- The two dark blocks in `src/styles.css` (the media query and `:root[data-theme="dark"]`) always carry the same values.
- Message times: 5000 ms for a result, 10000 ms for a result with an action. The Replace question on Save view lasts 5000 ms.
- The message text element keeps the id `status`.
- Search with `rg` and `fd`, never `grep` or `find`.
- Checks before every commit: `npm run check`, `npx prettier --check "src/**/*.ts" tests`, and the UI test: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui` (it uses port 1439 and must end with `all checks passed`).
- If Prettier reports a file, run `npm run format` and confirm with `git diff --stat` that only files this task names changed.
- Stage only the files a task names. Never stage `.claude/`, `skills-lock.json`, or files under `docs/superpowers/specs/` that the task does not name.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Each of these has a test in the task that owns the code.

1. A message that replaces another while the first one's clock is running: a failure must not be cleared by the clock of the result it replaced (Task 2).
2. A saved vehicle value that is out of range when the app starts, as from a hand-edited settings file: the field shows its line and the default is used (Task 4).
3. The dark theme chosen by the `data-theme` attribute instead of the system setting: the same tokens (Task 1).
4. A number field that is emptied: the last valid value stays in use (Task 4).
5. A view name that is a property of every object, such as `constructor`: it saves without the Replace question (Task 3).
6. A narrow panel: the two columns of findings stack and keep their order (Task 5).

---

### Task 1: Colours that meet the contrast minimums

**Files:**
- Modify: `src/styles.css` (token blocks, the A/B/C buttons, the finding badges, the amber marks, the dialog backdrop)
- Modify: `src/state.ts` (`Theme`, `theme()`, new `contrast` and `inkOn`)
- Modify: `src/app.ts` (`buildGrid`, the import from `./state`)
- Modify: `DESIGN.md` (colour tokens and the contrast rule)
- Modify: `site/styles.css` (`--muted`)
- Test: `tests/ui.mjs`

**Interfaces:**
- Produces, in `src/state.ts`: `export const contrast: (a: RGB, b: RGB) => number` and `export function inkOn(fill: RGB): string`. `Theme` gains `inkLight: string` and `inkDark: string`; `Theme.warn` now holds `--warn-mark`.
- Produces, in `src/styles.css`: the tokens `--on-fill-light`, `--on-fill-dark`, `--on-run-a`, `--on-run-b`, `--on-run-c`, `--on-good`, `--on-warn`, `--on-crit`, `--on-note`, `--warn-mark`, `--backdrop`.
- Produces, in `tests/ui.mjs`: `window.__contrast(a, b)` in every page the test opens, and the helpers `textContrast(page, selector)` and `tokenContrast(page, tokenName)`. Later tasks do not use them.

- [ ] **Step 1: Add the contrast helpers to the test**

In `tests/ui.mjs`, inside `open`, add this before `await page.goto(url);`:

```js
    // WCAG contrast of two colours as the page reports them, "#rrggbb" or "rgb(r, g, b)", for the contrast checks
    await page.addInitScript(() => {
      const parse = c => (c[0] === '#' ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : c.match(/[\d.]+/g).slice(0, 3).map(Number));
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
```

After the line `const settle = page => page.waitForTimeout(250);` add:

```js
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
```

- [ ] **Step 2: Add the failing checks**

After the existing line that starts `check('finding summary',` add:

```js
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
```

After the existing line `await shot(page, '05-fuel-table');` add:

```js
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
```

In the phone and tablet loop at the end, after the `check(name + ' layout fits, switch rows included', …);` statement, add:

```js
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
      await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
      const byAttribute = await read();
      await page.evaluate(() => delete document.documentElement.dataset.theme);
      check(
        'both dark theme blocks carry the same tokens',
        bySystem === byAttribute && bySystem === '#8b8e96,#8b8e96,#3987e5,#199e70,#060606,#060606,#fab219',
        bySystem + ' | ' + byAttribute,
      );
    }
```

- [ ] **Step 3: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: seven `FAIL` lines, and every older check still `ok`:

```
FAIL A, B and C read on their buttons  [2.82,3.2,4.42]
FAIL every badge reads  [3.35,...]
FAIL the tag grey reads on a panel  4.41
FAIL run colours and markers show on a panel  [4.34,3.15,2.77,0,5.6]
FAIL every number in the grid tables reads on its cell  ...
FAIL phone in the dark theme: A and the Note badge read  ...
FAIL both dark theme blocks carry the same tokens  ...
FAIL tablet in the dark theme: A and the Note badge read  ...
```

(The tablet line makes eight. The numbers can differ in the last digit.)

- [ ] **Step 4: Change the tokens**

In `src/styles.css`, replace the light `:root{…}` block's lines from `--ink:#1d1f23;` through the `--good:` line so the block reads:

```css
:root{
  --bg:#f6f6f7; --surface:#fdfdfe; --inset:#f1f1f3;
  --ink:#1d1f23; --ink-2:#5b5e66; --ink-3:#686b73;
  --grid:#ececef; --rule:#dcdce1;
  /* a selected control is a pale chip, the filled button is charcoal, and a panel sits on a faint shadow with no border */
  --sel:#e8e9ed; --sel-ink:#1d1f23; --primary:#2a2c31; --on-primary:#fdfdfe;
  --panel-edge:transparent; --panel-shadow:0 1px 2px rgb(24 26 30 / .05),0 10px 28px -18px rgb(24 26 30 / .2);
  --run-a:#2875d2; --run-b:#eb6834; --run-c:#159c6c;
  /* text on a colour is one of two inks, whichever reaches 4.5:1 on that fill */
  --on-fill-light:#ffffff; --on-fill-dark:#060606;
  --on-run-a:var(--on-fill-light); --on-run-b:var(--on-fill-dark); --on-run-c:var(--on-fill-dark);
  --on-good:var(--on-fill-dark); --on-warn:var(--on-fill-dark); --on-crit:var(--on-fill-light); --on-note:var(--on-fill-light);
  /* --crit is the system's redline: risk in findings, and the red bar that ends the header's rule.
     --warn-mark is amber as a line or a mark on a panel, where --warn, the badge's fill, is too pale in the light theme */
  --good:#0ca30c; --warn:#fab219; --warn-mark:#b87f00; --crit:#c81e33; --note:#686b73;
  --seq-lo:#cde2fb; --seq-hi:#0d366b;
  --div-neg:#2a78d6; --div-mid:#e8e8ea; --div-pos:#e34948;
  --font-display:"Lato","Helvetica Neue",Arial,system-ui,sans-serif;
  --font-body:"Roboto","Helvetica Neue",Arial,system-ui,sans-serif;
}
```

In **both** dark blocks (inside `@media (prefers-color-scheme: dark)` and in `:root[data-theme="dark"]`) make these three changes:

- `--ink-3:#83868e` becomes `--ink-3:#8b8e96`
- `--note:#83868e` becomes `--note:#8b8e96`
- after the `--run-a:#3987e5; --run-b:#d95926; --run-c:#199e70;` line add the line `--on-run-a:var(--on-fill-dark); --on-note:var(--on-fill-dark); --warn-mark:#fab219;`

After the `:root[data-theme="dark"]{…}` block add:

```css
/* declared for ::backdrop as well: older engines do not let it inherit from the root */
:root,::backdrop{--backdrop:rgb(8 10 14 / .5)}
```

- [ ] **Step 5: Use the tokens in the rules**

In `src/styles.css`:

Replace the three pressed-button rules with:

```css
.ab button.r0[aria-pressed="true"]{background:var(--run-a);border-color:var(--run-a);color:var(--on-run-a)}
.ab button.r1[aria-pressed="true"]{background:var(--run-b);border-color:var(--run-b);color:var(--on-run-b)}
.ab button.r2[aria-pressed="true"]{background:var(--run-c);border-color:var(--run-c);color:var(--on-run-c)}
```

Replace the three `.finding .ico` lines with:

```css
.finding .ico{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font:900 12px var(--font-display);margin-top:1px}
.finding.good .ico{background:var(--good);color:var(--on-good)} .finding.warn .ico{background:var(--warn);color:var(--on-warn)}
.finding.crit .ico{background:var(--crit);color:var(--on-crit)} .finding.info .ico{background:var(--note);color:var(--on-note)}
```

Replace `dialog::backdrop{background:rgba(8,10,14,.5)}` with `dialog::backdrop{background:var(--backdrop)}`.

Replace `.key.mark.warn{border-bottom-color:var(--warn)}` with `.key.mark.warn{border-bottom-color:var(--warn-mark)}` (the `.key.mark.crit` rule on the same line stays).

Replace the two flagged readout lines with:

```css
.ro.flag.crit{outline-color:var(--crit)} .ro.flag.warn{outline-color:var(--warn-mark)}
.ro.flag .lb::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ink-2);margin-right:5px}
.ro.flag.crit .lb::before{background:var(--crit)} .ro.flag.warn .lb::before{background:var(--warn-mark)}
```

Then run `rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(" src/styles.css` and confirm every match is inside the three token blocks at the top or the `:root,::backdrop` rule.

- [ ] **Step 6: Let the canvases and the grid read the new tokens**

In `src/state.ts`, in `interface Theme`, add two lines after `ink3: string;`:

```ts
  /** the two inks for text on a colour: light and dark */
  inkLight: string;
  inkDark: string;
```

and change the `warn: string;` line to:

```ts
  /** amber as a line or a mark on a panel */
  warn: string;
```

In `theme()`, add after `ink3: g('--ink-3'),`:

```ts
    inkLight: g('--on-fill-light'),
    inkDark: g('--on-fill-dark'),
```

and change `warn: g('--warn'),` to `warn: g('--warn-mark'),`.

After the line `export const css = (c: RGB, k = 1) => …;` add:

```ts
/** Relative luminance of a colour, as WCAG defines it. */
const luminance = (c: RGB) => {
  const [r, g, b] = c.map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two colours, from 1 to 21. */
export const contrast = (a: RGB, b: RGB) => {
  const x = luminance(a) + 0.05;
  const y = luminance(b) + 0.05;
  return x > y ? x / y : y / x;
};
/** The colour for text on a filled cell: whichever of the two fill inks contrasts more with the fill. */
export function inkOn(fill: RGB): string {
  const th = theme();
  return contrast(rgb(th.inkLight), fill) >= contrast(rgb(th.inkDark), fill) ? th.inkLight : th.inkDark;
}
```

In `src/app.ts`, add `inkOn,` to the import from `./state` (the list is alphabetical: after `hideTip,`). In `buildGrid`, replace:

```ts
        const c = sc.color(v);
        const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
        td.style.background = css(c);
        td.style.color = lum > 0.6 ? '#10151c' : '#ffffff';
```

with:

```ts
        const c = sc.color(v);
        td.style.background = css(c);
        td.style.color = inkOn(c);
```

- [ ] **Step 7: Bring DESIGN.md and the site's token into line**

In `DESIGN.md`, front matter `colors:`: `muted: "#686b73"`, `run-a: "#2875d2"`, `run-c: "#159c6c"`, and after `check: "#fab219"` add:

```yaml
  check-mark: "#b87f00"
  on-fill-light: "#ffffff"
  on-fill-dark: "#060606"
```

In the table of section 2, change three rows and add three after the `check` row:

```markdown
| `muted` | #686b73 | #8b8e96 | Captions and entries that are not active. |
| `run-a` | #2875d2 | #3987e5 | Data only: the first overlaid pull. |
| `run-c` | #159c6c | #199e70 | Data only: the third. |
| `check-mark` | #b87f00 | #fab219 | `check` as a line or a mark on a panel, where the badge's amber is too pale in the light theme. |
| `on-fill-light` | #ffffff | #ffffff | Text on a run colour or a severity badge, when the fill is dark. |
| `on-fill-dark` | #060606 | #060606 | The same, when the fill is light. |
```

After the paragraph that ends "or `muted` for a note." add:

```markdown
Text is at least 4.5:1 against what it sits on, and a line or a mark on a chart at least 3:1. Text on a colour is `on-fill-light` or `on-fill-dark`, whichever reaches 4.5:1: in the light theme A is light and B and C are dark, in the dark theme all three are dark. A number on a table cell takes whichever of the two contrasts more with the cell.
```

In `site/styles.css`, change `--muted:#74777f` to `--muted:#686b73`.

- [ ] **Step 8: Run the checks and see everything pass**

Run: `npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`, with the eight new lines `ok`.

- [ ] **Step 9: Commit**

```bash
git add src/styles.css src/state.ts src/app.ts DESIGN.md site/styles.css tests/ui.mjs
git commit -m "Colours: text and marks meet the contrast minimums

The third grey, run A and run C are a step darker. Text on a run colour or a
badge is one of two inks by token, and a number on a table cell takes the ink
that contrasts more. Amber marks on a panel have their own token.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One message area at the bottom of the window

**Files:**
- Create: `src/messages.ts`
- Modify: `index.html` (the header loses `#status`; the message area is added before `#tip`)
- Modify: `src/styles.css` (`#status` rule replaced by the `.msg` rules)
- Modify: `src/app.ts` (every `status(…)` call, `flushSettings`, `recompute`, `syncSwitches`, `boot`)
- Modify: `DESIGN.md` (the Message component)
- Modify: `tests/site-shots.mjs` (one comment)
- Test: `tests/ui.mjs`

**Interfaces:**
- Produces, in `src/messages.ts`:
  - `export interface Action { label: string; run: () => void }`
  - `export const say: (text: string, act?: Action) => void` — a result; clears itself after 5000 ms, or 10000 ms with an action
  - `export const progress: (text: string) => void` — work under way; stays until the next message
  - `export const fail: (text: string, act?: Action) => void` — a failure; stays until dismissed
  - `export function clearMessage(prefix?: string): void` — with a prefix, clears only a message that starts with it
  - `export function wireMessages(): void`
- Produces, in the page: `#msg` (class `on` while a message shows, `fail` for a failure), `#status` (the text), `#msg-act` (the action button), `#msg-x` (Dismiss). Task 3 uses `say` with an action and reads `#msg-act` in its test.

- [ ] **Step 1: Add the failing checks**

In `tests/ui.mjs`, after the existing `check('a CSV that is not an NSP log is refused with a reason', …);` statement add:

```js
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
```

In the switch rows part, after the existing `check('rows that arrive leave any other message alone', …);` statement and before the `await box.uncheck();` that follows it, add:

```js
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
  errors.splice(errorsBeforeRetry, errors.length - errorsBeforeRetry, ...errors.slice(errorsBeforeRetry).filter(m => !/ERR_FAILED/.test(m)));
```

In the watch folder part, after the existing `check('watch folder imports a new log', …);` statement and before `await page.close();`, add:

```js
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
  check('a failure outlasts the clock of the result it replaced', /notes\.csv: /.test(await text(page, 'status')), await text(page, 'status'));
```

In the same file, change the two comments that say "status line" to say "message area" (`rg -n "status line" tests/ui.mjs`).

- [ ] **Step 2: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected `FAIL` lines: `a failure is shown at the bottom of the window with Dismiss`, `Dismiss clears it`, `Try again brings the rows back and clears the message`, `a result stays in view when the page scrolls, and clears itself`. The check `a failure outlasts the clock of the result it replaced` is `ok` already, because nothing clears a message today.

- [ ] **Step 3: Write the messages module**

Create `src/messages.ts`:

```ts
// The message area: one line fixed to the bottom of the window.
// A result clears itself, work under way stays until the next message, and a failure stays until it is dismissed.

import { $ } from './state';

/** How long a result stays, in ms: on its own, and when it carries an action such as Undo. */
const STAY = 5000;
const STAY_WITH_ACTION = 10000;

/** A button beside a message, such as Try again or Undo. */
export interface Action {
  label: string;
  run: () => void;
}
type Kind = 'result' | 'progress' | 'failure';

let timer = 0;
/** How long the message on screen stays, in ms. 0: it does not clear itself. */
let stay = 0;
let action: Action | null = null;

function startClock(): void {
  clearTimeout(timer);
  timer = stay ? window.setTimeout(() => clearMessage(), stay) : 0;
}

function show(kind: Kind, text: string, act?: Action): void {
  if (!text) return clearMessage();
  action = act ?? null;
  stay = kind === 'result' ? (act ? STAY_WITH_ACTION : STAY) : 0;
  $('status').textContent = text;
  $('msg').classList.add('on');
  $('msg').classList.toggle('fail', kind === 'failure');
  const ab = $('msg-act');
  ab.hidden = !act;
  ab.textContent = act ? act.label : '';
  $('msg-x').hidden = kind !== 'failure';
  startClock();
}

/** Something finished. The message clears itself. */
export const say = (text: string, act?: Action) => show('result', text, act);
/** Work is under way. The message stays until the next one. */
export const progress = (text: string) => show('progress', text);
/** Something failed. The message stays until it is dismissed, or until `clearMessage` is called for it. */
export const fail = (text: string, act?: Action) => show('failure', text, act);

/**
 * Clear the message. With a prefix, only a message that starts with it:
 * a request that succeeds clears its own earlier failure and leaves any other message alone.
 */
export function clearMessage(prefix = ''): void {
  const st = $('status');
  if (prefix && !st.textContent?.startsWith(prefix)) return;
  clearTimeout(timer);
  timer = 0;
  stay = 0;
  action = null;
  st.textContent = '';
  $('msg').classList.remove('on', 'fail');
  $('msg-act').hidden = true;
  $('msg-x').hidden = true;
}

/** Wire the message area's buttons, and stop its clock while the pointer or the focus is on it. */
export function wireMessages(): void {
  const box = $('msg');
  $('msg-x').addEventListener('click', () => clearMessage());
  $('msg-act').addEventListener('click', () => {
    const a = action;
    clearMessage();
    a?.run();
  });
  const hold = () => clearTimeout(timer);
  box.addEventListener('pointerenter', hold);
  box.addEventListener('focusin', hold);
  box.addEventListener('pointerleave', startClock);
  box.addEventListener('focusout', startClock);
}
```

- [ ] **Step 4: Move the element and style it**

In `index.html`, delete the line `<span id="status" role="status" aria-live="polite"></span>` from the header, and add this before `<div id="tip" hidden></div>`:

```html
<div class="msg" id="msg">
  <span id="status" role="status" aria-live="polite"></span>
  <button class="btn sm" id="msg-act" type="button" hidden></button>
  <button class="btn sm" id="msg-x" type="button" hidden>Dismiss</button>
</div>
```

In `src/styles.css`, delete the rule `#status{color:var(--ink-2);font-size:12.5px;max-width:46ch}`, and add after the `#tip .tk i{…}` rule:

```css
/* the message area: one line fixed to the bottom of the window, drawn as the tooltip is. It is always in the page,
   so the live region inside it is read; without .on it cannot be seen or clicked */
.msg{position:fixed;z-index:15;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);transform:translateX(-50%);display:flex;align-items:center;gap:10px;width:max-content;max-width:min(640px,calc(100vw - 32px));background:var(--surface);color:var(--ink-2);border:1px solid var(--rule);border-radius:12px;padding:8px 10px 8px 14px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .14s}
.msg.on{opacity:1;pointer-events:auto}
.msg.fail{color:var(--ink)}
#status{min-width:0;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.msg .btn{flex:none}
```

- [ ] **Step 5: Send every message through the module**

In `src/app.ts`:

Add the import after the import from `./data`:

```ts
import { clearMessage, fail, progress, say, wireMessages } from './messages';
```

Delete the `status` helper:

```ts
const status = (text: string) => {
  $('status').textContent = text;
};
```

Replace `flushSettings` with:

```ts
/** How each failure that offers Try again starts. The same request succeeding later clears a message that starts with it. */
const SETTINGS_FAILED = 'Settings were not saved: ';
const DYNO_FAILED = 'Power estimate failed: ';
const LIBRARY_FAILED = 'The library could not be opened: ';

function writeSettings(): void {
  api.setSettings(collectSettings()).then(
    () => clearMessage(SETTINGS_FAILED),
    e => fail(SETTINGS_FAILED + errText(e), { label: 'Try again', run: writeSettings }),
  );
}
function flushSettings(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  writeSettings();
}
```

(The three constants go above `collectSettings`, under the `// ---------- settings ----------` heading.)

In `recompute`, replace:

```ts
  } catch (e) {
    status('Power estimate failed: ' + errText(e));
    return;
  }
  if (seq !== dynSeq) return;
```

with:

```ts
  } catch (e) {
    // a request that a newer one has replaced does not report: its failure is not about what is on screen
    if (seq === dynSeq) fail(DYNO_FAILED + errText(e), { label: 'Try again', run: () => void recompute() });
    return;
  }
  if (seq !== dynSeq) return;
  clearMessage(DYNO_FAILED);
```

In `removeLog`: `status('Removed ' + …)` becomes `say('Removed ' + …)` with the same text, and `status(errText(e))` becomes `fail(errText(e))`.

In `syncSwitches`, change the doc comment on `SW_FAILED` to `/** How the message starts while a request for switch rows has failed. */`, replace

```ts
      if ($('status').textContent?.startsWith(SW_FAILED)) status('');
```

with

```ts
      clearMessage(SW_FAILED);
```

and replace

```ts
      if (seq === swSeq) status(SW_FAILED + errText(e));
```

with

```ts
      if (seq === swSeq) fail(SW_FAILED + errText(e), { label: 'Try again', run: retrySwitches });
```

and add after `syncSwitches`:

```ts
/** Ask again for the rows of the span on screen, after a request for them failed. */
function retrySwitches(): void {
  swKey = '';
  drawAll();
}
```

In `addFiles`: `status('Reading ' + f.name)` becomes `progress('Reading ' + f.name)`; replace

```ts
    status(
      (added ? 'Added ' + added + (added > 1 ? ' logs, ' : ' log, ') + pulls + ' new ' + (pulls === 1 ? 'pull' : 'pulls') + '. ' : '') +
        errs.join(' '),
    );
  } catch (e) {
    status(errText(e));
  }
```

with

```ts
    const text =
      (added ? 'Added ' + added + (added > 1 ? ' logs, ' : ' log, ') + pulls + ' new ' + (pulls === 1 ? 'pull' : 'pulls') + '. ' : '') +
      errs.join(' ');
    // a refused file is a failure, so the refusal stays on screen
    if (errs.length) fail(text);
    else say(text);
  } catch (e) {
    fail(errText(e));
  }
```

In `scanWatch`, replace

```ts
      status(
        (r.added.length
          ? 'Added ' + r.added.length + (r.added.length > 1 ? ' logs' : ' log') + ' from the watch folder. '
          : 'No new logs in the watch folder. ') + r.errors.join(' '),
      );
    }
  } catch (e) {
    status(errText(e));
  }
```

with

```ts
      const text =
        (r.added.length
          ? 'Added ' + r.added.length + (r.added.length > 1 ? ' logs' : ' log') + ' from the watch folder. '
          : 'No new logs in the watch folder. ') + r.errors.join(' ');
      if (r.errors.length) fail(text);
      else say(text);
    }
  } catch (e) {
    fail(errText(e));
  }
```

In `wire`: make `wireMessages();` its first statement. In the `onLogsChanged` callback, `() => status(msg)` becomes `() => say(msg)` and `e => status(errText(e))` becomes `e => fail(errText(e))`. In the `watch-pick` handler, `status(errText(e))` becomes `fail(errText(e))`. In the `watch-stop` handler, `status('Stopped watching. …')` becomes `say('Stopped watching. …')` with the same text.

In `boot`: `status('Could not read saved settings: ' + errText(e))` becomes `fail('Could not read saved settings: ' + errText(e))`. Replace

```ts
  try {
    await reload();
  } catch (e) {
    $('sub').textContent = 'The library could not be opened';
    status(errText(e));
  }
```

with `await openLibrary();`, and add above `boot`:

```ts
/** Read the library for the first time. A failure offers to try again. */
async function openLibrary(): Promise<void> {
  try {
    await reload();
    clearMessage(LIBRARY_FAILED);
  } catch (e) {
    $('sub').textContent = 'The library could not be opened';
    fail(LIBRARY_FAILED + errText(e), { label: 'Try again', run: () => void openLibrary() });
  }
}
```

Then run `rg -n "status\(" src/app.ts` and confirm there is no match, and `rg -n "status line" src` and change any comment that says "status line" to "message area".

In `tests/site-shots.mjs`, the comment `// a fresh page drops the message about the import from the header` becomes `// a fresh page drops the message about the import`.

- [ ] **Step 6: Add the component to DESIGN.md**

In `DESIGN.md` section 4, after the **Status tag** line, add:

```markdown
- **Message.** One line fixed to the bottom of the app's window: `surface-card` with a `hairline-strong` outline and 12px corners, as the tooltip is. A result is `body` text and clears itself; a failure is `ink` text, stays until it is dismissed, and carries the action that fixes it. Never red, never a filled bar.
```

- [ ] **Step 7: Run the checks and see everything pass**

Run: `npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`.

- [ ] **Step 8: Commit**

```bash
git add src/messages.ts src/app.ts src/styles.css index.html DESIGN.md tests/ui.mjs tests/site-shots.mjs
git commit -m "Messages: one area at the bottom of the window

Every message goes through src/messages.ts. A result clears itself, a failure
stays until it is dismissed, and four failures offer Try again and clear when
the same request next succeeds. The header no longer carries a message line.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Saved views: undo a delete, ask before replacing

**Files:**
- Modify: `src/app.ts` (`loadView`, the `view-save` and `view-del` handlers, a new `disarmReplace`)
- Test: `tests/ui.mjs`

**Interfaces:**
- Consumes, from Task 2: `say(text: string, act?: Action)` from `./messages`, already imported in `src/app.ts`; `#msg-act` in the page.
- Produces: nothing later tasks use.

- [ ] **Step 1: Add the failing checks**

In `tests/ui.mjs`, after the existing line `check('view saved', (await text(page, 'view-msg')) === 'Saved “Warm-up”.');` add:

```js
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
  check('a name every object has saves without asking', plain.msg === 'Saved “constructor”.' && plain.view === 'constructor', JSON.stringify(plain));
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
```

- [ ] **Step 2: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected `FAIL` lines: `saving over another view asks first`, `deleting a view says so and offers Undo`, `Undo puts the view back and loads it`. Every older check stays `ok`.

- [ ] **Step 3: Ask before replacing another view**

In `src/app.ts`, under the `// ---------- saved views ----------` heading, after `const FINDING_OPTION = …;` add:

```ts
/** The name Save view is asking about before it replaces that view, and the clock that withdraws the question. */
let replaceAsked = '';
let replaceTimer = 0;

/** Put Save view back as it was, if it is asking before replacing a view. */
function disarmReplace(): void {
  if (!replaceAsked) return;
  replaceAsked = '';
  clearTimeout(replaceTimer);
  $('view-save').textContent = 'Save view';
}
```

In `loadView`, add `disarmReplace();` as the first statement after the `if (nm === FINDING_OPTION) return;` line.

In `wire`, in the `view-save` handler, add after the block that ends `input('view-name').focus(); return; }`:

```ts
    // saving over another view asks first; saving the view that is loaded is how its changes are kept.
    // Object.keys, not `in`: "constructor" is on every object and is not a saved view
    if (Object.keys(S.views).includes(nm) && nm !== S.viewName && replaceAsked !== nm) {
      disarmReplace();
      replaceAsked = nm;
      $('view-save').textContent = 'Replace';
      $('view-msg').textContent = 'A view called “' + nm + '” exists. Replace it?';
      replaceTimer = window.setTimeout(() => {
        disarmReplace();
        $('view-msg').textContent = '';
      }, 5000);
      return;
    }
    disarmReplace();
```

After the `view-save` handler add:

```ts
  input('view-name').addEventListener('input', () => {
    if (!replaceAsked) return;
    disarmReplace();
    $('view-msg').textContent = '';
  });
```

- [ ] **Step 4: Offer Undo after a delete**

Replace the `view-del` handler's body with:

```ts
    const nm = $<HTMLSelectElement>('view-sel').value;
    if (nm === 'Default' || nm === FINDING_OPTION) return;
    const kept = S.views[nm];
    delete S.views[nm];
    loadView('Default');
    say('Deleted “' + nm + '”.', {
      label: 'Undo',
      run: () => {
        // a view saved under the name since then is not replaced
        if (Object.keys(S.views).includes(nm)) return;
        S.views[nm] = kept;
        loadView(nm);
      },
    });
```

- [ ] **Step 5: Run the checks and see everything pass**

Run: `npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts tests/ui.mjs
git commit -m "Saved views: undo a delete, ask before replacing another view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Vehicle fields refuse values outside their range

**Files:**
- Modify: `src/app.ts` (`collectSettings`, `readVeh`, `renderVehSum`, the vehicle part of `wire`, `boot`, new `vehOk`, `fieldValid`, `checkField`)
- Modify: `src/styles.css` (`.field-hint`, the invalid outline)
- Test: `tests/ui.mjs`

**Interfaces:**
- Consumes: `VEH_IDS`, `VEH_DEFAULT`, `MODEL_FIELDS`, `el`, `fmt`, `LB` from `./state`, already imported.
- Produces: nothing later tasks use.

- [ ] **Step 1: Add the failing checks**

In `tests/ui.mjs`, in the vehicle dialog part, after the existing line `await page.fill('#v-driver', '140');` and before `await page.click('#veh-close');`, add:

```js
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
  check('an empty field keeps the line and the last valid value', emptied.hint === 'Enter 0 to 1,500. Using 140.' && emptied.lb === 2902, JSON.stringify(emptied));
  await page.fill('#v-driver', '140');
  await page.waitForFunction(() => document.getElementById('veh-btn-txt').textContent === 'Vehicle · 2,902 lb');
  const fixed = await field();
  check('a valid value clears the line', fixed.hint === null && fixed.invalid === null && fixed.describedBy === null, JSON.stringify(fixed));
```

After the watch folder part's `await page.close();` and before the comment `// phone and tablet widths, dark mode: …`, add:

```js
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
    atStart.value === '80' && atStart.hint === 'Enter 800 to 9,000. Using 2,762.' && atStart.btn === 'Vehicle · 2,902 lb · check 1 field' && atStart.lb === 2902,
    JSON.stringify(atStart),
  );
  await page.waitForTimeout(600); // the settings written now hold the default again, for the pages below
  await page.close();
```

- [ ] **Step 2: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected `FAIL` lines: `no line under a field while it is being typed in` (the weight in use is 4,762 lb), `an out-of-range value shows the range and is not used`, `an empty field keeps the line and the last valid value`, `a saved value out of range is shown with its line, and the default is used`. `a valid value clears the line` is `ok` already.

- [ ] **Step 3: Keep the last valid text of each field**

In `src/app.ts`, under the `// ---------- model ----------` heading and above `readVeh`, add:

```ts
/** The last valid text of each vehicle field. The estimate and the saved settings use these, never a value outside a field's range. */
const vehOk: Record<string, string> = {};

/** Whether a field's text is a value the estimate can use. A number field carries its range in the page; the others take any text. */
function fieldValid(inp: HTMLInputElement): boolean {
  if (inp.type !== 'number') return true;
  const v = parseFloat(inp.value);
  return v === v && v >= +inp.min && v <= +inp.max;
}

const plain = (s: string) => Number(s).toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * Take a field's text if it is valid; otherwise keep the last valid one in use.
 * `tell` shows the line under a field that is not valid. It is false while the field is being typed in,
 * so the line does not appear on the way to a valid number; a line already showing stays until the value is valid.
 */
function checkField(k: string, tell: boolean): void {
  const inp = input(VEH_IDS[k]);
  const hintId = inp.id + '-hint';
  let hint = document.getElementById(hintId);
  if (fieldValid(inp)) {
    vehOk[k] = inp.value;
    hint?.remove();
    inp.removeAttribute('aria-invalid');
    inp.removeAttribute('aria-describedby');
    return;
  }
  if (!hint) {
    if (!tell) return;
    hint = el('p', 'field-hint');
    hint.id = hintId;
    inp.after(hint);
    inp.setAttribute('aria-invalid', 'true');
    inp.setAttribute('aria-describedby', hintId);
  }
  hint.textContent = 'Enter ' + plain(inp.min) + ' to ' + plain(inp.max) + '. Using ' + plain(vehOk[k]) + '.';
}
```

In `collectSettings`, change `for (const k in VEH_IDS) veh[k] = input(VEH_IDS[k]).value;` to `for (const k in VEH_IDS) veh[k] = vehOk[k];`.

In `readVeh`, change `const v = parseFloat(input(VEH_IDS[k]).value);` to `const v = parseFloat(vehOk[k]);`, change `tire: input('v-tire').value,` to `tire: vehOk.tire,`, and change `gears: input('v-gears')` followed by `.value.split(/[,\s]+/)` to `gears: vehOk.gears` followed by `.split(/[,\s]+/)`.

- [ ] **Step 4: Check fields as they change, and say how many need attention**

In `renderVehSum`, replace the last line with:

```ts
  const bad = document.querySelectorAll('#veh-dlg [aria-invalid="true"]').length;
  $('veh-btn-txt').textContent = 'Vehicle · ' + fmt(v.mass / LB) + ' lb' + (bad ? ' · check ' + bad + (bad === 1 ? ' field' : ' fields') : '');
```

In `wire`, replace the loop

```ts
  for (const k of Object.keys(VEH_IDS)) {
    input(VEH_IDS[k]).addEventListener('input', () => {
      if ((MODEL_FIELDS as readonly string[]).includes(k)) {
        S.model = 'custom';
        modelSel.value = 'custom';
      }
      void recompute();
    });
  }
```

with

```ts
  for (const k of Object.keys(VEH_IDS)) {
    const inp = input(VEH_IDS[k]);
    inp.addEventListener('input', () => {
      if ((MODEL_FIELDS as readonly string[]).includes(k)) {
        S.model = 'custom';
        modelSel.value = 'custom';
      }
      checkField(k, false);
      void recompute();
    });
    // leaving a field that is not valid shows what it takes
    inp.addEventListener('change', () => {
      checkField(k, true);
      renderVehSum();
    });
  }
```

In the `modelSel` change handler, replace `if (c) for (const k of MODEL_FIELDS) input(VEH_IDS[k]).value = String(c[k]);` with:

```ts
    if (c)
      for (const k of MODEL_FIELDS) {
        input(VEH_IDS[k]).value = String(c[k]);
        checkField(k, true);
      }
```

In `boot`, replace `for (const k in VEH_IDS) input(VEH_IDS[k]).value = String(veh[k]);` with:

```ts
  for (const k in VEH_IDS) {
    // a saved value that is out of range is shown with its line, and the default is used
    vehOk[k] = String(VEH_DEFAULT[k]);
    input(VEH_IDS[k]).value = String(veh[k]);
    checkField(k, true);
  }
```

- [ ] **Step 5: Style the line and the field**

In `src/styles.css`, after the `.field input[type="range"]{…}` rule add:

```css
.field-hint{font-size:11.5px;color:var(--ink-2)}
.field input[aria-invalid="true"]{border-color:var(--ink)}
```

- [ ] **Step 6: Run the checks and see everything pass**

Run: `npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/styles.css tests/ui.mjs
git commit -m "Vehicle: a value outside a field's range is not used

The estimate and the saved settings keep the field's last valid value. The
field says what it takes once it is left, and the Vehicle button says how
many fields need attention.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Findings keep their column, and five small fixes

**Files:**
- Modify: `index.html` (skip link, `main`, the two findings lists, the power chart's label)
- Modify: `src/styles.css` (`.findings`, `.fcol`, `.finding`, `.skip`, the focus rule)
- Modify: `src/app.ts` (`scrollTo`, the header line in `reload`, `renderFindings`, new `fillFindings`)
- Modify: `CLAUDE.md` (the notes)
- Test: `tests/ui.mjs`

**Interfaces:**
- Consumes: `findingNode(f: Finding): HTMLLIElement`, already in `src/app.ts`.
- Produces: in the page, each of `#find-all` and `#find-run` is a `div.findings` holding one or two `ul.fcol`, each holding `li.finding` items.

- [ ] **Step 1: Add the failing checks**

In `tests/ui.mjs`:

Replace the existing `header counts` check with:

```js
  check('header line', (await text(page, 'sub')) === '8 logs · 10 pulls · E63 on the flex sensor', await text(page, 'sub'));
```

After the contrast checks that follow `check('finding summary', …)` add:

```js
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
```

Before the comment `// phone and tablet widths, dark mode: …` add:

```js
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
```

In the phone and tablet loop, after the `await shot(page, '07-' + name, true);` line and before `await page.close();`, add:

```js
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
```

- [ ] **Step 2: Run the UI test and see the new checks fail**

Run: `npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected `FAIL` lines: `header line`, `findings keep their column when one closes`, `the work column is the main landmark, and the chart says where its values are`, `Replay scrolls with behavior auto when Reduce Motion is reduce`, `on a phone the two columns of findings stack in order`, and the two `the first Tab stop skips to the charts and findings` lines. `Replay scrolls with behavior smooth when Reduce Motion is no-preference` is `ok` already.

- [ ] **Step 3: The page: skip link, landmark, findings lists, chart label**

In `index.html`:

- Add as the first line inside `<body>`: `<a class="skip" href="#main">Skip to the charts and findings</a>`
- Change `<div class="main">` to `<main class="main" id="main" tabindex="-1">`, and its closing `</div>` (the one just before the `</div>` that closes `.layout`) to `</main>`.
- Change `<ul class="findings" id="find-all"></ul>` to `<div class="findings" id="find-all"></div>` and `<ul class="findings" id="find-run"></ul>` to `<div class="findings" id="find-run"></div>`.
- On `#dyno-cv`, change the `aria-label` to `Estimated wheel power and torque against engine speed for the selected pulls. The Table button shows the values.`

- [ ] **Step 4: The styles**

In `src/styles.css`:

Replace

```css
.findings{columns:380px 2;column-gap:14px}
.finding{border:1px solid var(--grid);border-radius:8px;min-width:0;break-inside:avoid;margin-bottom:8px}
```

with

```css
/* two columns side by side, each its own list, so a finding stays in its column when another opens or closes.
   The track is at least half the panel, which caps the columns at two; under 380px each they stack */
.findings{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,max(380px,calc((100% - 14px) / 2))),1fr));gap:0 14px;align-items:start}
.fcol{min-width:0}
.finding{border:1px solid var(--grid);border-radius:8px;min-width:0;margin-bottom:8px}
```

Change the focus rule's selector list from `button:focus-visible,input:focus-visible,…` to start with `a:focus-visible,button:focus-visible,input:focus-visible,…` (the rest of the rule is unchanged).

After the `.row{…}` rule add:

```css
/* skip link: the first Tab stop, on screen only while it has focus */
.skip{position:fixed;z-index:30;left:calc(env(safe-area-inset-left,0px) + 16px);top:calc(env(safe-area-inset-top,0px) + 10px);transform:translateY(-300%);background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:700;text-decoration:none;border-radius:8px;padding:7px 12px}
.skip:focus{transform:none}
.main:focus{outline:none}
```

- [ ] **Step 5: The code**

In `src/app.ts`:

Replace the `scrollTo` line with:

```ts
/** Bring a panel into view. The scroll is animated unless the system asks for reduced motion. */
const scrollTo = (id: string) =>
  $(id).scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
```

In `reload`, replace the `$('sub').textContent = …;` statement with:

```ts
  $('sub').textContent = logs.length
    ? logs.length +
      (logs.length === 1 ? ' log · ' : ' logs · ') +
      S.pulls.length +
      (S.pulls.length === 1 ? ' pull' : ' pulls') +
      (ov.ethanol !== null ? ' · E' + fmt(ov.ethanol) + ' on the flex sensor' : '')
    : 'No logs yet';
```

Replace the first six statements of `renderFindings` (from `const a = $('find-all');` through the second `for` loop) with two calls, and add `fillFindings` above it:

```ts
/**
 * Fill a findings list as two columns, the first half by count in the first.
 * Each column is its own list, so a finding stays in its column when another opens or closes.
 */
function fillFindings(box: HTMLElement, findings: Finding[], none: string): void {
  box.textContent = '';
  const column = (items: Finding[]) => {
    const ul = el('ul', 'fcol');
    for (const f of items) ul.appendChild(findingNode(f));
    box.appendChild(ul);
    return ul;
  };
  if (!findings.length) return void column([]).appendChild(el('li', 'hint', none));
  const half = Math.ceil(findings.length / 2);
  column(findings.slice(0, half));
  if (findings.length > 1) column(findings.slice(half));
}

function renderFindings(): void {
  fillFindings($('find-all'), S.findings, 'Nothing flagged across these logs.');
  fillFindings($('find-run'), S.runFindings, 'Pick a pull as run A to check it.');
  const all = S.findings.concat(S.runFindings);
  const n = (k: Sev) => all.filter(f => f.sev === k).length;
  $('find-sum').textContent = all.length
    ? n('crit') + ' risk · ' + n('warn') + ' to check · ' + n('info') + ' notes · ' + n('good') + ' OK'
    : '';
}
```

- [ ] **Step 6: The notes**

In `CLAUDE.md`, section "Planned", after the bullet that starts "- App UI pass with `redesign-existing-projects`, 2026-10-04." (and its indented continuation line), add:

```markdown
- UI review with `ui-ux-pro-max`, 2026-10-04 (https://claude.ai/artifact/RNaXck6LX1briQPyayHxZ9): 23 findings, and an order the owner approved.
  Step 1 is built, from `docs/superpowers/specs/2026-10-04-ui-review-fixes-design.md` by `docs/superpowers/plans/2026-10-04-ui-review-fixes.md`: colours that meet the contrast minimums, the message area at the bottom of the window, vehicle fields that refuse values outside their range, undo for a deleted view, findings that keep their column, a shorter header line, the `main` landmark and a skip link.
  Still to do, in order: the replay's height with the chips, the log list, touch and text sizes, the phone and tablet structure (from a prototype), then keyboard movement in lists, marks on the power chart, run letters, export and the type scale.
```

In section "Rules for this project", add at the end:

```markdown
- Messages to the person go through `src/messages.ts`: `say` for a result, `progress` for work under way, `fail` for a failure. Nothing else writes to `#status`.
- Colours: no raw colour in a rule outside the token blocks of `src/styles.css`. Text on a colour uses the `--on-…` tokens; text is at least 4.5:1 and a line or mark at least 3:1.
```

- [ ] **Step 7: Run the checks and see everything pass**

Run: `npm run check && npx prettier --check "src/**/*.ts" tests && npm run build && cargo build --release -p logviewer-dev && npm run test:ui`

Expected: `all checks passed`.

- [ ] **Step 8: Commit**

```bash
git add index.html src/styles.css src/app.ts CLAUDE.md tests/ui.mjs
git commit -m "Findings keep their column; header line, landmark, skip link

Each findings list is two columns that are their own lists, so opening one
finding no longer moves the others between columns. The header line drops the
channel and sample counts, the work column is the main landmark behind a skip
link, and scrolling to a panel respects Reduce Motion.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
