# Log Viewer

A virtual dyno: reads ECU logs (Haltech NSP `PCLog_*.csv` today), estimates wheel power, and reports what to change in the tune.
One codebase for macOS, Windows, iPhone and iPad: Rust core, TypeScript canvas UI (no framework), Tauri 2 shell.
See README.md for layout, commands and log import paths.

## Commands

- `npm install` then `npm run app` — desktop app in dev mode (`tauri dev`). `./run-app.command` does the same and logs to `run-app.log`.
- `npm run app:build` — installers for the current OS.
- `npm run test:core` — core against `crates/core/tests/golden.json` (snapshot from `testdata/logs`) plus library tests.
- `npm run build && cargo build --release -p logviewer-dev && npm run test:ui` — Playwright end-to-end test of the UI against the real core over HTTP.
- `npm run core -- --dir .logviewer` + `npm run dev` — UI in a browser without the native shell.
- `npm run site:shots` — retakes the website's screenshots in `site/img` from the real UI (same builds as the UI test). Preview the site with `python3 -m http.server 4173 -d site`.
- After an intended analysis change: `UPDATE_GOLDEN=1 cargo test -p logviewer-core`.
  The snapshot was made on Linux x86-64. Refreshing it on another CPU also rewrites the last digit of thousands of numbers, all inside the test's 1e-6 tolerance. For a small change, add the new values to the existing file instead.

## State of things

- Core and UI are tested (golden snapshot, library tests, end-to-end browser test). Developed on Linux; all three also pass on macOS arm64 (2026-10-04).
  The UI test needs Playwright's Chromium: `npx playwright install chromium`.
- macOS, checked 2026-10-04: `npm run app` and `npm run app:build` work. Seen in the native window: log list, dyno chart, ignition table, findings, replay.
  The Tauri IPC path in `src/api.ts` works (`invoke('call' | 'call_bytes')`).
- Opening a CSV with the app works on macOS in all three cases: cold launch, app already running, path as an argument.
  The library is opened in `run()` before the event loop starts, not in the setup hook: on a cold launch macOS delivers `RunEvent::Opened` before setup runs.
- A file opened at launch is imported with no status message, and an import error at launch is not shown: the UI is not listening for `logs-changed` yet.
- Not checked on macOS: vehicle dialog, watch-folder picker (dialog plugin), Add logs, drag and drop. They need clicks in the native window.
- Never built: Windows and iOS. Never exercised: AirDrop, `Info.ios.plist`, the Finder file association of an installed app.
- `ci/github-build.yml` is a GitHub Actions workflow that has not been run. Move it to `.github/workflows/build.yml` to enable it.
- CSP is `null` in `tauri.conf.json`; tighten now that the app runs.

## Planned

- Repository: https://github.com/alecholmez/log-viewer (public, Apache-2.0). Work is to be tracked as GitHub issues there.
- Log formats: the target is every format Virtual Dyno reads (https://barnhill.bitbucket.io/, about 60 listed on 2026-10-04). Link is next.
- A GitHub Pages site that hosts the app downloads, as that page does for Virtual Dyno. Built in `site/` (static HTML and CSS, the app's colours and type, screenshots from `tests/site-shots.mjs`), with `.github/workflows/pages.yml` to publish it.
  Live at https://alecholmez.github.io/log-viewer/ since 2026-10-04; every push to `main` that changes `site/` redeploys it. The download rows say "Coming soon"; there is no release to link to.
  Owner call 2026-10-04: changes to the site can be committed and pushed as they are made ("it can just be updated live"). That covers `site/` and what it needs; other commits and pushes still wait to be asked for.
  It calls the app a virtual dyno and does not tie itself to NSP: the "Supported ECUs" chart lists the Virtual Dyno formats, with a check on each one the app reads (Haltech today). Add `class="yes"` and the check icon to an `<li>` when a format lands.
- Design system: `DESIGN.md` is the source of truth for the look of the site and the app (owner call 2026-10-04). Structure after BMW M's DESIGN.md from github.com/VoltAgent/awesome-design-md, colour after works teams such as GR and STI: a neutral canvas, heavy sentence-case Lato headlines over Roboto Light, soft corners (6, 8 and 12px), no shadows, and one red used only as the redline at the end of a rule and for risk.
  The owner rejected the app's grey-blue and an orange accent on the page, did not want BMW's colours, and rejected Saira Condensed for headlines: Lato for display and Roboto for text are the owner's choice. The first version, with square corners and capitals everywhere, was too brutalist for the owner; it was softened the same day.
  The same system is saved as a Claude design system at https://claude.ai/artifact/9cvuybFUMqs3w78teUsVsb (tokens, brand book, fonts, cover; no components yet).
  Light is the default theme (owner call 2026-10-04, after seeing a dark-only page). The site follows the system and is light for every visitor; the dark theme stays defined for the app's dark mode.
  The app has not been restyled to it yet: its screenshots on the site still show the old blue-grey panels.
  The page describes only what has been checked: nothing about AirDrop or iPhone-specific import.
- Replay: show on/off and state channels as rows on the timeline instead of line graphs, appearing on their own for any switch that changes during the pull. Being designed, not built.
- App UI pass with `redesign-existing-projects`, 2026-10-04. Applied: hover, press and transition states on controls, sentence-case subheads (panel titles and tags stay in capitals), tinted shadows, `text-wrap: pretty` on prose, a car icon on the Vehicle button (Phosphor, as on the website), the 3D table growing to fill its panel, and a refused duplicate naming the file once.
  Then, same day: unselected pulls lose their boxes and the text actions their underlines; an empty library shows one "Add your first log" panel in place of the charts (`.app.no-logs`, set in `renderLogs`); naming, saving and deleting a view moved into the Channels picker.
  Switch rows: design in `docs/superpowers/specs/2026-10-04-replay-switch-rows-design.md`, waiting for review. Not built.
- Design work uses the taste skills in `.claude/skills` (from github.com/Leonxlnx/taste-skill, MIT): `design-taste-frontend` for the landing page, `redesign-existing-projects` for the app UI. The first says of itself that it is not for dashboards or dense product UI, so it does not apply to the app.

## Rules for this project

- All numbers are computed in `crates/core`. The UI formats and draws; it does not analyse.
- Every platform goes through `Session::dispatch` (`crates/core/src/session.rs`). Add a command there, then expose it in `src/api.ts`.
- `!(x > y)` comparisons in the core are deliberate: they are also true for NaN (a missing sample).
- Smoothing changes only what is drawn: the power curve, its peaks and the weight band. Findings and the fuel check read the curve as computed, so a display setting never changes the diagnosis.
- UI copy: minimal and direct. No metaphors or analogies. Call things what they are ("Ignition table", "Fuel table", "Accelerator pedal", "Throttle plate").
- Findings are the product. Each one states evidence from the log, why it matters, and numbered changes with values derived from the data. Readers range from tuners to people starting from a base map.
- NSP unit scaling in `haltech.rs` was inferred from logs, not from Haltech documentation.
- Other ECUs (Link next) go in a module beside `haltech.rs`; the dyno and tables use only the channel roles in `log.rs`.

## The test car (for sanity checks)

BRZ with a turbo K20Z3 swap, 4.44 final drive, 215/45R17, stock curb weight 2,762 lb + 140 lb driver. Dyno'd 330 whp on E85.
The logs in `testdata/logs` predate an idle fix and are E62–63, part throttle (≤70% accelerator, 8.8 psi), so the app estimates 164–207 whp on them at the default Medium smoothing (165–207 with Smoothing off).
