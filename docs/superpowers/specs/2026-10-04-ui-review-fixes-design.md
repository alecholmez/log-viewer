# UI review: the first fixes

Status: the owner read the UI review (https://claude.ai/artifact/RNaXck6LX1briQPyayHxZ9) on 2026-10-04 and approved its order: "the suggested order you would fix things make sense to me. Lets start doing that."

This is step 1 of that order: the fixes that need no design choice. It covers findings 7, 11, 12, 13, 17, 18, 22 and 23, the landmark and skip link from finding 6, and the chart description from finding 10.
The phone layout, touch sizes, the replay's height, the log list and keyboard movement in lists are later steps.

## Rules this design keeps

- `DESIGN.md` is the source of truth for the look. The red is the redline and risk only: it is not used for a failed request or an invalid field.
- Text is at least 4.5:1 against what it sits on. Lines and marks on a chart are at least 3:1. The ratios below use the WCAG formula.
- UI copy is minimal and direct.
- The UI formats and draws. Nothing here changes what the core computes.

## 1. Colours

### Token changes

| Token | Light, was | Light, now | Dark, was | Dark, now | Why |
| --- | --- | --- | --- | --- | --- |
| `--ink-3`, `--note` | `#74777f` | `#686b73` | `#83868e` | `#8b8e96` | Tags, units and axis text: 4.41 on a panel and 3.97 on a card in light, 4.26 on a card in dark. Now 5.24, 4.73 and 4.73. |
| `--run-a` | `#2a78d6` | `#2875d2` | `#3987e5` | no change | White on the A button was 4.42. Now 4.60. |
| `--run-c` | `#1baf7a` | `#159c6c` | `#199e70` | no change | The line on a light panel was 2.77. Now 3.44. |

`--div-neg` stays `#2a78d6`: it is the fuel table's scale, not a run.

### New tokens

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--on-fill-light` | `#ffffff` | same | Light text on a colour. |
| `--on-fill-dark` | `#060606` | same | Dark text on a colour. |
| `--on-run-a` | light | dark | Text on a run's colour: the A, B and C buttons. |
| `--on-run-b`, `--on-run-c` | dark | dark | |
| `--on-good`, `--on-warn` | dark | dark | Text on a finding's badge. |
| `--on-crit` | light | light | |
| `--on-note` | light | dark | |
| `--warn-mark` | `#b87f00` | `#fab219` | Amber as a line or a mark on a panel. `--warn` stays the badge's fill. |
| `--backdrop` | `rgb(8 10 14 / .5)` | same | Behind a dialog. |

Every text pair above is at least 4.6:1. `--on-fill-dark` is `#060606` because the table cells need it: with a lighter dark ink, a mid-tone cell can fall to 4.28.

### Where they are used

- The pressed A, B and C buttons take `--on-run-a`, `--on-run-b`, `--on-run-c`.
- A finding's badge takes `--on-good`, `--on-warn`, `--on-crit` or `--on-note`.
- `--warn-mark` colours the amber marker on the power chart and under the traces, the shading and label marker of a flagged trace, the legend's marker, and the outline and dot of a flagged readout card. On a light panel the marker was 1.80:1; it is 3.40.
- A number in the grid table is drawn in whichever of `--on-fill-light` and `--on-fill-dark` contrasts more with its cell. Today a brightness threshold picks, and five of the 52 numbered cells in the ignition grid are under 4.5.
- The dialog's backdrop takes `--backdrop`.
- No rule in `src/styles.css` keeps a raw colour outside the token blocks.

`DESIGN.md` and `site/styles.css` (`--muted`) take the same values. The website's screenshots are retaken after the merge.

## 2. Messages

Today 17 places write to one line in the header. The header scrolls away, and a message never clears.

### The message area

- One line fixed to the bottom of the window, centred, above the page and under a tooltip. It is a `--surface` box with the tooltip's `--rule` outline, 12px corners and no shadow.
- It holds the text, an action button when the message has one, and `Dismiss` on a failure.
- Three kinds:
  - **A result** ("Added 8 logs, 10 new pulls.") clears itself after 5 seconds, or 10 when it carries an action.
  - **Work in progress** ("Reading PCLog_….csv") stays until the next message replaces it.
  - **A failure** stays until it is dismissed or the thing it reports succeeds. Its text is `--ink`; the other kinds are `--ink-2`.
- The clock stops while the pointer is over the message or focus is inside it, and starts again from the full time when they leave.
- A new message replaces the one on screen.
- The text is a live region (`role="status"`, polite), always in the page, so a screen reader reads each message.
- It keeps the id `status`, and the header no longer has a message line.
- While the Vehicle dialog is open the message area is behind the dialog's backdrop. A failure is still there when the dialog closes.

### What each message becomes

| Message | Kind | Action |
| --- | --- | --- |
| `Reading <file>` | in progress | |
| `Added N logs, M new pulls.` | result; a failure when a file was refused, so the refusal stays on screen | |
| `Removed <log> from the library. The original file is untouched.` | result | |
| `Added N logs from the watch folder.`, `No new logs in the watch folder.` | result; a failure when the scan reports an error. A scan made when the window comes to the front does not show the same failure twice, and a scan that works clears that failure if it is still on screen | |
| `Stopped watching. Logs already added stay in the library.` | result | |
| A message from the shell when a file is opened with the app | result | |
| `Power estimate failed: …` | failure | `Try again` asks for the estimate again |
| `Settings were not saved: …` | failure | `Try again` writes them again |
| `Switch rows failed: …` | failure | `Try again` asks for the rows again |
| `The library could not be opened: …` | failure | `Try again` reads the library again |
| `Could not read saved settings: …`, and any other error | failure | |

The four failures with `Try again` clear on their own when the same request next succeeds, as the switch rows message does today. Each clears only its own message.

## 3. Saved views

- **Delete view** still acts at once. The message area says `Deleted “Idle”.` with `Undo` for 10 seconds. `Undo` puts the view back and loads it. If a view with that name has been saved in the meantime, `Undo` does nothing.
- **Save view** with the name of another saved view asks first: the line beside the buttons says `A view called “Idle” exists. Replace it?` and the button reads `Replace`. A second click replaces it. Editing the name, choosing another view, or 5 seconds without a click puts `Save view` back.
- Saving under the name of the view that is loaded does not ask. That is how changes to a view are saved.

## 4. The vehicle form

The number fields carry their ranges in the page (`min` and `max`), and the app ignores them: 80 lb of curb weight is used as typed.

- A number field's value counts when it is a number inside the field's range. Anything else, an empty field included, is not used: the app keeps computing with the field's last valid value, and never saves the other one.
- A field that is not valid shows one line under it once the field is left (or at once if it was already showing): `Enter 800 to 9,000. Using 2,762.` The line goes as soon as the value is valid.
- The field is marked `aria-invalid` and described by that line. Its outline turns `--ink`. No red.
- The header's Vehicle button says how many fields need attention: `Vehicle · 2,902 lb · check 1 field`.
- Choosing a model fills its fields with valid values and clears their lines.
- A saved value that is out of range (a hand-edited settings file) is shown with its line, and the default is used.
- Tire size and gear ratios are text and are not checked here. The acceleration slider cannot leave its range.

## 5. Findings keep their column

The findings are laid out in balanced columns, so the browser moves them between columns whenever one opens or closes.

- Each list of findings is two columns side by side. The first half of the findings, by count, goes in the first column and the rest in the second. Opening or closing a finding moves only the findings under it in the same column.
- The reading order is unchanged: down the first column, then down the second.
- Under about 780px of panel width the two columns stack into one.
- One finding takes one column's width, as today.

## 6. Small changes

- **The header line** reads `8 logs · 10 pulls · E63 on the flex sensor`. The channel count, the sample count and the logging rate go.
- **Landmark and skip link.** The work column is the page's `main` landmark. The first Tab stop in the page is a link, `Skip to the charts and findings`, that is on screen only while it has focus and moves focus to `main`.
- **Reduce Motion.** `Replay`, `Show in replay` and `Open … table` scroll without animation when the system setting is on.
- **The power chart's description** for screen readers ends with `The Table button shows the values.`

## Edge cases

- A message arrives while another is on screen: it replaces it, with its own clock.
- A failure is on screen and a result arrives: the result replaces it. The failure was about an earlier action.
- `Try again` fails again: the same message comes back.
- Two fields are invalid: each has its own line, and the header says `check 2 fields`.
- A field is cleared and left: its line shows, and the last valid value is still in use.
- An empty library, or no pull chosen as run A: one column with the one line the list shows today.

## Testing

UI test (`tests/ui.mjs`), on the sample logs:

- contrast, computed in the page from the colours as drawn: the tag grey on a panel, A, B and C on their pressed buttons, each badge's glyph, and every numbered cell of the ignition grid are at least 4.5:1; run C's colour and `--warn-mark` are at least 3:1 on a panel; the same for the dark theme's A button and Note badge;
- a result is shown at the bottom of the window with the page scrolled to its end, and clears by itself;
- a failure stays, `Dismiss` clears it, and `Try again` on a failed switch rows request brings the rows back and clears the message;
- deleting a view and `Undo` brings it back with its channels; saving over another view's name asks, and the second click replaces;
- 2000 in Driver and cargo: no line while typing; after leaving the field, the line under it, the header's `check 1 field`, and the power figures unchanged; an empty field keeps the line; 140 clears both;
- a saved curb weight of 80 is shown with its line at start-up, and the default is used;
- a view named `constructor` saves without asking;
- a failure that replaces a result is not cleared by the result's clock;
- with the dark theme set by attribute, the tokens equal the ones the system setting gives;
- closing the first finding leaves every finding in the column it was in; on a phone the two columns stack;
- the header line; the skip link is the first Tab stop and moves focus to `main`; with Reduce Motion on, `Replay` scrolls without animation.

The core's tests and the golden snapshot do not change.

## Not in this design

- The findings header's counts as filters, and opening only the first risk on a phone (finding 17's second half).
- Arrow-key movement in the lists and the picker (finding 6's second half).
- Marks on the power chart from a click, run letters at the curve ends, export, the type scale (findings 8, 9, 20, 21).
- Touch sizes and text sizes (findings 3 and 5), the phone and tablet structure (1, 2, 4), the replay's height (16), the log list (15, 19).
- A second, assertive live region for failures.
- Checks on tire size and gear ratios.
