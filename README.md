# Log Viewer

Reads ECU logs, estimates wheel power from them, and says what to change in the tune.

Supported today: Haltech NSP laptop logs (`PCLog_*.csv`). The format code is one module, so other ECUs (Link next) are added beside it.

One codebase builds the macOS, Windows, iPhone and iPad apps.

## Run it

Needs [Rust](https://rustup.rs) and Node 20 or newer. macOS also needs the Xcode command line tools. Windows needs the Visual Studio C++ build tools; WebView2 ships with Windows 10 and 11.

```sh
npm install
npm run app          # the desktop app, with live reload
npm run app:build    # installers: .dmg on macOS, .exe and .msi on Windows
```

A build is made on the system it is for. Building on a Mac gives the Mac app; the Windows installers come from a Windows machine or from GitHub Actions. `ci/github-build.yml` is a workflow that runs the tests and builds both apps on every push and attaches the installers to the run; move it to `.github/workflows/build.yml` to turn it on.

Builds are unsigned until signing is set up. On macOS that means right-click, Open the first time; for distribution add a Developer ID certificate and notarization ([Tauri's guide](https://tauri.app/distribute/sign/macos/)).

### iPhone and iPad

Needs Xcode and an Apple developer team.

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
export APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX   # your team ID
npm run tauri ios init                     # creates the Xcode project in src-tauri/gen/apple, once
npm run tauri ios dev                      # run in the simulator or on a device
npm run tauri ios build                    # archive for TestFlight and the App Store
```

The bundle identifier is `io.waypoint.logviewer` (`src-tauri/tauri.conf.json`). `src-tauri/Info.ios.plist` is merged into the app's Info.plist; it registers the app for CSV files so AirDrop, Files and the share sheet offer "Log Viewer".

The layout is one column on a phone; on an iPad the logs list sits beside the charts. Touch works throughout: drag the traces to scrub, drag the 3D table to rotate.

## Getting logs into the app

Logs are copied into the app's own library, so the original can be moved or deleted afterwards. Removing a log in the app removes the library copy only.

| Way | Where |
| --- | --- |
| **Add logs** button | Everywhere. On iPhone and iPad it opens Files, which includes iCloud Drive, Google Drive and any other provider installed. |
| Drag files onto the window | Desktop |
| Open with Log Viewer, or drop on the app icon | Desktop |
| AirDrop or share a CSV, then pick Log Viewer | iPhone, iPad, Mac |
| **Watch folder** | Desktop. Pick a folder; new NSP logs in it are added when the app opens or comes to the front. |

Tuning laptop to another machine, with no cable: save NSP logs into a Google Drive, iCloud Drive or OneDrive folder on the laptop. On a Mac or PC, point Watch folder at the synced folder. On a phone or tablet, use Add logs and pick the file from that drive.

A log that is already in the library is recognised by its contents, whatever the file is called, and is not added twice. A log removed in the app is not brought back by the watch folder; add it by hand to get it back.

## How it is built

```
crates/core        Rust. All parsing and analysis. No UI or platform code.
  src/haltech.rs     NSP export format, unit scaling, channel names
  src/log.rs         a loaded log: time base and channels in engineering units
  src/dyno.rs        pull detection, virtual dyno
  src/table.rs       ignition and fuel tables binned from logs
  src/findings.rs    detectors: what is wrong, why it matters, what to change
  src/session.rs     library on disk and the command surface (`Session::dispatch`)
crates/devserver   Rust. The same commands over HTTP, for a browser and for tests.
src-tauri          Rust. The native shell: owns a Session, forwards commands, handles opened files.
src                TypeScript. The UI: DOM and canvas, no framework.
  api.ts             the only file that talks to the core (IPC in the app, HTTP in a browser)
  app.ts             panels, controls, importing
  charts.ts          power chart, replay traces, 3D table
  state.ts           app state, constants, shared helpers
tests/ui.mjs       end-to-end test of the UI against the real core
testdata/logs      eight real logs the tests run on
site               the website: one static page, published to GitHub Pages
```

Every platform runs the same `Session::dispatch`. The UI asks for `logs`, `log_data`, `overview`, `dyno` and so on, and draws what comes back. Numbers are computed in Rust; the UI only formats them.

The library is in the system's app-data directory for `io.waypoint.logviewer` (`~/Library/Application Support/io.waypoint.logviewer` on macOS): `logs/` holds the imported files, `settings.json` holds the vehicle, saved views and names.

## Tests

```sh
npm run test:core    # core against a snapshot from the real logs; library import, duplicates, watch folder
npm run build && cargo build --release -p logviewer-dev
npm run test:ui      # drives the UI in a browser: import, dyno, findings, views, replay, phone and tablet widths
```

`crates/core/tests/golden.json` holds every pull, table cell, finding sentence and dyno curve for the logs in `testdata/logs`. A change in the analysis shows up as a diff against it. After an intended change, refresh it with `UPDATE_GOLDEN=1 cargo test -p logviewer-core`.

To work on the UI in a browser without the native shell:

```sh
npm run core -- --dir .logviewer    # the core on http://127.0.0.1:1430
npm run dev                         # the UI on http://localhost:1420
```

## Website

`site/` is the page that hosts the downloads: plain HTML and CSS with no build step. `.github/workflows/pages.yml` publishes it to GitHub Pages on a push that changes it.

```sh
npm run build && cargo build --release -p logviewer-dev
npm run site:shots                     # retake the screenshots from the real UI, light and dark
python3 -m http.server 4173 -d site    # then open http://localhost:4173
```

The screenshots are the app itself on the logs in `testdata/logs`, so retake them after a change to the UI. Opened as a file the page gets no fonts; serve it as above. The download rows say "Coming soon" until there is a release to link to.

## Adding an ECU

1. Add a module beside `haltech.rs` that parses the ECU's export into a `RawLog` and gives each channel a unit and scale.
2. Map its channel names onto the roles in `log.rs` (`rpm`, `map`, `lam`, …). The dyno and tables use only those roles.
3. Detectors in `findings.rs` that read ECU-specific channels (idle control terms, launch control state) need the equivalent channels named for the new ECU; detectors that use only the roles work as they are.
4. In the UI, `src/data.ts` and the default view in `src/state.ts` name a few NSP channels directly. Move those behind the same role mapping.

## What to know about the numbers

- Unit scaling for NSP channel types was worked out from the logs, not from Haltech documentation. The common ones (RPM, pressure, lambda, angle, temperature, percentage) are checked against plausible engine values; unusual channel types fall back to raw values.
- The power curve is smoothed along engine speed; **Smoothing** above the chart sets how much, and Off shows the curve as first computed. The peaks are read from the curve that is drawn, so they move a little with the setting. The curve keeps its whole rpm range at every level. Findings and the fuel check are read from the curve as first computed, so the setting does not change them. A finding about the shape of the curve, such as a torque dip, is marked on the chart: a pointer under the point it names, and a thin line showing that stretch before smoothing.
- The virtual dyno is road-load math: mass × acceleration + drag + rolling resistance. Road gradient and wind are not measured, so compare runs on the same road rather than trusting one peak. Two checks are shown with each run: ECU speed against gearing, and commanded fuel flow against the power estimate.
- The vehicle catalog is a small sample. The 2013 BRZ is from Subaru's specification sheet; treat the rest as starting points and override them.
