---
version: alpha
name: log-viewer
description: A motorsport-engineering interface for a virtual dyno. A quiet neutral canvas, heavy headlines over light body type, soft corners, no shadows. Light by default, with a dark theme. One red, used only as the redline at the end of a rule. Structure after BMW M's system, softened; colour in the black, white and red of works teams such as GR and STI.

colors:
  canvas: "#f4f4f4"
  surface-card: "#fcfcfc"
  surface-elevated: "#ececee"
  hairline: "#dcdce0"
  hairline-strong: "#b4b4bb"
  ink: "#0d0e10"
  body: "#3d3d43"
  muted: "#6a6a72"
  on-ink: "#f4f4f5"
  redline: "#c81e33"
  run-a: "#2a78d6"
  run-b: "#eb6834"
  run-c: "#1baf7a"
  check: "#fab219"
  ok: "#0ca30c"

typography:
  display-xl: { family: Lato, size: 56px, weight: 900, line: 1.05, tracking: -0.015em }
  display-lg: { family: Lato, size: 40px, weight: 900, line: 1.1, tracking: -0.01em }
  title: { family: Lato, size: 19px, weight: 700, line: 1.25 }
  button: { family: Roboto, size: 16px, weight: 700, line: 1.2 }
  label: { family: Roboto, size: 13px, weight: 700, line: 1.2 }
  lede: { family: Roboto, size: 20px, weight: 300, line: 1.5 }
  body: { family: Roboto, size: 17px, weight: 300, line: 1.55 }
  body-dense: { family: Roboto, size: 13px, weight: 400, line: 1.45 }
  caption: { family: Roboto, size: 15px, weight: 300, line: 1.5 }

rounded:
  tag: 6px
  control: 8px
  box: 12px
  full: 9999px

spacing:
  xs: 8px
  sm: 12px
  md: 20px
  lg: 32px
  xl: 48px
  section: 96px
---

# Log Viewer design system

Log Viewer is a virtual dyno: it reads ECU logs, estimates wheel power and says what to change in the tune.
This file is the source of truth for how it looks, on the website in `site/` and in the app. Token, rule and reason are kept together.

## 1. Visual theme and atmosphere

Motorsport engineering, not consumer tech. A quiet neutral canvas, heavy black headlines, hairlines, soft corners. Light is the default; a dark theme mirrors it.
The interface has no decoration of its own. Its energy comes from the data: the power curves, the tables, the findings, shown large and edge to edge.
The structure follows BMW M's system, softened: its square corners and capitals everywhere read as brutalist, so corners are rounded and headlines are sentence case. The colour does not follow it: it is the black, white and single red of works teams such as GR and STI.

## 2. Colour palette and roles

Light is the default theme, on the site and in the app. The dark theme keeps every role and is what the app shows when the system is set to dark.

| Token | Light | Dark | Role |
|---|---|---|---|
| `canvas` | #f4f4f4 | #0d0e10 | The page. Never pure white or pure black. |
| `surface-card` | #fcfcfc | #17181b | A panel. Elevation is a different surface, never a shadow. |
| `surface-elevated` | #ececee | #222327 | A control resting on a panel. |
| `hairline` | #dcdce0 | #2a2c31 | Dividers and panel edges. |
| `hairline-strong` | #b4b4bb | #45474e | Outlines of controls and tags. |
| `ink` | #0d0e10 | #f4f4f5 | Headlines, labels, the filled button. |
| `on-ink` | #f4f4f5 | #0d0e10 | Text on an ink fill. |
| `body` | #3d3d43 | #b9b9be | Running text. |
| `muted` | #6a6a72 | #85858c | Captions and entries that are not active. |
| `redline` | #c81e33 | #e0263c | The only brand colour. |
| `run-a` | #2a78d6 | #3987e5 | Data only: the first overlaid pull. |
| `run-b` | #eb6834 | #d95926 | Data only: the second. |
| `run-c` | #1baf7a | #199e70 | Data only: the third. |
| `check` | #fab219 | #fab219 | Finding severity: to check. |
| `ok` | #0ca30c | #0ca30c | Finding severity: OK. |

`redline` appears as the short red bar that ends a rule, as the redline ends a tachometer, and as the risk colour in findings. It is never a button, a fill or a text colour.
The run colours are for data only. A finding is `redline` for risk, `check`, `ok`, or `muted` for a note.

## 3. Typography

Two families. **Lato** Black (900) and Bold (700) for headlines, panel titles and big figures: the stamped voice, and the face of the app's wordmark.
**Roboto** for everything read as text: 300 at reading sizes, 400 in the dense app, 700 for labels.

- Headlines are sentence case. Capitals are kept for the wordmark only.
- Heavy display against light body is the signature. Do not set body text bold to add emphasis.
- Buttons and text links are 16px Roboto 700. Tags are 13px Roboto 700. No tracked capitals.
- Numbers that line up use tabular figures.
- Below 15px, body text is weight 400. Roboto Light does not hold up at the app's 12 to 13px.

## 4. Components

- **Button.** Flat, 48px tall, 8px corners. Primary: `ink` fill, `on-ink` text, a shade dimmer on hover. Secondary: clear with a `hairline-strong` outline that turns `ink` on hover. One primary per view.
- **Text link.** Bold text with an arrow and a quiet underline that brightens on hover.
- **Redline rule.** A 1px `hairline` across the container that ends in a `redline` bar 4px tall and about 9% long. It marks a major division, at most once per screen. It is the only decorative element in the system.
- **Panel.** `surface-card`, 1px `hairline`, 12px corners. Title in `title`.
- **Screenshot.** The app itself, on real logs, never a drawing of it. A whole window gets a `hairline` frame with 12px corners. A panel is placed straight on the canvas.
- **Chart of supported ECUs.** One list in columns. A supported entry is `ink`, bold, with a check; the rest are `muted`.
- **Status tag.** 13px bold text in a `hairline-strong` outline with 6px corners, for "Coming soon" and "Next".

## 5. Layout

Container 1280px with 32px gutters. 96px between sections, 64px on a phone. A 12-column grid; asymmetric splits before centred stacks.
One message per section: a headline, at most two sentences, one visual.

## 6. Depth and elevation

No shadows, no gradients, no glow. Three levels only: canvas, card, elevated control. Hairlines do the separating.

## 7. Do and don't

- Do let a real screenshot carry each section.
- Do keep the red to the redline and to risk. If something else wants colour, it is data: use the run colours.
- Do use the three radii: `tag` 6px, `control` 8px, `box` 12px. `full` is for round icon buttons.
- Don't use the red on a button, a link, a background or a headline.
- Don't add shadows, gradients or glows.
- Don't set headlines or buttons in capitals, and don't set body text in bold.
- Don't use metaphors in copy. Call things what they are.

## 8. Responsive behaviour

Below 900px everything is one column and the nav links go; the hero shows one finding in place of the whole window.
Below 720px the findings panel is replaced by one finding. Touch targets are at least 44px.

## 9. Agent prompt guide

- "Build a section for the Log Viewer site: sentence-case Lato Black headline, two sentences of Roboto Light, one real screenshot on the canvas, 12px corners, no shadows, no colour except data."
- "Restyle this app panel to the system: `surface-card`, 1px `hairline`, 12px corners, title in `title`, figures in the display face with tabular numbers."
- Before shipping, check: is the red anywhere other than a redline or a risk? Is any corner square, or rounder than 12px? Is any headline in capitals?
