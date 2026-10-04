---
version: alpha
name: log-viewer
description: A motorsport-engineering interface for a virtual dyno. Near-black canvas, white uppercase condensed headlines over light body type, square corners, no shadows. One red, used only as the redline at the end of a rule. Structure after BMW M's system; colour in the black, white and red of works teams such as GR and STI.

colors:
  canvas: "#0a0a0b"
  surface-card: "#17171a"
  surface-elevated: "#222226"
  hairline: "#2e2e33"
  hairline-strong: "#4a4a52"
  ink: "#f4f4f5"
  body: "#b9b9be"
  muted: "#85858c"
  on-ink: "#0a0a0b"
  redline: "#e0263c"
  run-a: "#3987e5"
  run-b: "#d95926"
  run-c: "#199e70"
  check: "#fab219"
  ok: "#0ca30c"

typography:
  display-xl: { family: Saira Condensed, size: 72px, weight: 700, line: 0.98, case: upper }
  display-lg: { family: Saira Condensed, size: 48px, weight: 700, line: 1.02, case: upper }
  title: { family: Saira Condensed, size: 22px, weight: 600, line: 1.15, tracking: 0.01em, case: upper }
  label: { family: Lato, size: 13px, weight: 700, line: 1.2, tracking: 0.115em, case: upper }
  lede: { family: Lato, size: 20px, weight: 300, line: 1.5 }
  body: { family: Lato, size: 17px, weight: 300, line: 1.55 }
  body-dense: { family: Lato, size: 13px, weight: 400, line: 1.45 }
  caption: { family: Lato, size: 15px, weight: 300, line: 1.5 }

rounded:
  none: 0px
  shot: 9px
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

Motorsport engineering, not consumer tech. A near-black canvas, white type, hairlines, square corners.
The interface has no decoration of its own. Its energy comes from the data: the power curves, the tables, the findings, shown large and edge to edge.
The structure follows BMW M's system. The colour does not: it is the black, white and single red of works teams such as GR and STI.

## 2. Colour palette and roles

- `canvas` #0a0a0b. The page. Never pure black.
- `surface-card` #17171a, `surface-elevated` #222226. A panel, and a control resting on a panel. Elevation is a lighter surface, never a shadow.
- `hairline` #2e2e33, `hairline-strong` #4a4a52. Dividers and panel edges; control outlines.
- `ink` #f4f4f5. Headlines, labels, the filled button. `on-ink` #0a0a0b is text on an ink fill.
- `body` #b9b9be, `muted` #85858c. Running text; captions and items that are not active.
- `redline` #e0263c. The only brand colour. It appears as the short red bar that ends a rule, as the redline ends a tachometer, and as the risk colour in findings. It is never a button, a fill or a text colour.
- `run-a` #3987e5, `run-b` #d95926, `run-c` #199e70. The three overlaid pulls. Data colours, used only for data.
- `check` #fab219, `ok` #0ca30c. Finding severities, with `redline` for risk and `muted` for a note.

The website is dark for every visitor. The app follows the system theme, because it is used in daylight and in a car; its light theme inverts the neutrals (canvas #f4f4f4, ink #0a0a0b) and keeps every role.

## 3. Typography

Two families. **Saira Condensed** 700 and 600, uppercase, for headlines, panel titles and big figures: the stamped voice of timing screens and pit boards.
**Lato** for everything read as text: 300 at reading sizes, 400 in the dense app, 700 for labels.

- Headlines are uppercase, always. Sentence case in a headline is off system.
- Heavy display against light body is the signature. Do not set body text bold to add emphasis.
- Labels, buttons and nav links are 13px Lato 700, uppercase, tracked 0.115em: the machined label.
- Numbers that line up use tabular figures.
- Below 15px, body text is weight 400. Lato Light does not hold up at the app's 12 to 13px.

## 4. Components

- **Button.** Square, flat, 48px tall, a `label`. Primary: `ink` fill, `on-ink` text; on hover the fill clears and the outline stays. Secondary: clear with a `hairline-strong` outline that turns `ink` on hover. One primary per view.
- **Text link.** A `label` with an arrow. No underline; the arrow moves on hover.
- **Redline rule.** A 1px `hairline` across the container that ends in a `redline` bar 4px tall and about 9% long. It marks a major division, at most once per screen. It is the only decorative element in the system.
- **Panel.** `surface-card`, 1px `hairline`, square. Title in `title`.
- **Screenshot.** The app itself, on real logs, never a drawing of it. A whole window gets a `hairline-strong` frame. A panel is placed straight on the canvas.
- **Chart of supported ECUs.** One list in columns. A supported entry is `ink`, bold, with a check; the rest are `muted`.
- **Status tag.** A `label` in a `hairline-strong` outline, for "Coming soon" and "Next".

## 5. Layout

Container 1280px with 32px gutters. 96px between sections, 64px on a phone. A 12-column grid; asymmetric splits before centred stacks.
One message per section: a headline, at most two sentences, one visual.

## 6. Depth and elevation

No shadows, no gradients, no glow. Three levels only: canvas, card, elevated control. Hairlines do the separating.

## 7. Do and don't

- Do let a real screenshot carry each section.
- Do keep the red to the redline and to risk. If something else wants colour, it is data: use the run colours.
- Do keep corners square. `shot` (9px) exists only to trim the app's own rounded panels in screenshots; `full` is for round icon buttons.
- Don't use the red on a button, a link, a background or a headline.
- Don't round buttons or cards, and don't add shadows.
- Don't write a headline in sentence case or body text in bold.
- Don't use metaphors in copy. Call things what they are.

## 8. Responsive behaviour

Below 900px everything is one column and the nav links go; the hero shows one finding in place of the whole window.
Below 720px the findings panel is replaced by one finding. Touch targets are at least 44px.

## 9. Agent prompt guide

- "Build a section for the Log Viewer site: uppercase Saira Condensed headline, two sentences of Lato Light, one real screenshot on the canvas, square corners, no shadows, no colour except data."
- "Restyle this app panel to the system: `surface-card`, 1px `hairline`, square, title in `title`, figures in the display face with tabular numbers."
- Before shipping, check: is the red anywhere other than a redline or a risk? Is any corner rounded? Is any headline in sentence case?
