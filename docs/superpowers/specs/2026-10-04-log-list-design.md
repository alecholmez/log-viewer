# Log list: date and time, file name, and why a log has no pull

Status: layout chosen by the owner on 2026-10-04 from the motion and log list study (https://claude.ai/artifact/XAiKwuxnEFFRJRTLsV5DmZ): "By log". The owner's reason: people tune in bursts over a couple of hours, so a list of logs each carrying its own date and time fits better than a list grouped by day.

Amended on 2026-10-05 with findings 15 and 19 of the UI review (https://claude.ai/artifact/RNaXck6LX1briQPyayHxZ9), which the owner approved as step 3 of its order: a log with no pull is one line until it is opened, the list opens on run A, and a pull's facts have a fixed layout. Those parts are marked "UI review" below. Where they differ from the first version of this design, they win.

## Why

- A log is named by its time alone ("1:45 pm log"). Across more than one day that is not enough to tell logs apart.
- The file name is not shown. People name files to say what a log was for, and that context is lost.
- The sample count is not useful in a list.
- Only some logs can be given the A, B or C slot, and the list does not say why. A, B and C hold pulls, and a log with no pull shows only "No pulls in this log."

## What it shows

### Each log

- **Title:** the name the person gave it, or the log's date and time: `Apr 17, 1:45 pm`. The year is added when it is not the current year: `Apr 17, 2025, 1:45 pm`.
- **Line under the title:** the length. When the log has been renamed, the date and time come first: `Apr 17, 1:45 pm · 72 s`.
- **Length:** under a minute as `41 s`, otherwise `3 min 34 s`.
- **File name:** on its own line in the quiet text colour, cut with an ellipsis when it does not fit, with the whole name in its `title`.
- The sample count is gone from the list.
- `Replay`, `Rename` and `Remove` stay as they are. Renaming starts from the date and time.

### When the log has no date

A log whose start the core cannot read is titled by its file name without the extension, as today. The file name line is left out, because the title already is the file name.

### The order

Logs are listed by start, oldest first, then by file name. Logs with no start come last, by file name. On the sample logs this is today's order.

### What a pull is

One line under the panel title, shown when the library has logs:

> A pull is RPM rising in one gear, with the car moving and the accelerator pedal at 15% or more, for at least 1.2 s and 700 rpm.

### Why a log has no pull

In place of "No pulls in this log.", one line that starts `No pulls:` and gives the reason in the log's own numbers. The first reason that applies is used:

| The log | The line |
|---|---|
| is never in gear and never reaches 12 km/h | `No pulls: the car stayed out of gear and did not move.` |
| is never in gear | `No pulls: the car stayed out of gear.` |
| never reaches 12 km/h | `No pulls: the car stayed under 12 km/h.` |
| has the accelerator pedal under 15% throughout | `No pulls: the accelerator pedal peaked at 14.7%, under the 15% a pull needs.` |
| has a stretch that meets the rule but is too short or gains too little | `No pulls: the longest stretch of rising RPM in one gear lasted 0.8 s and gained 310 rpm. A pull needs 1.2 s and 700 rpm.` |
| anything else | `No pulls: RPM never rose in gear with the accelerator pedal at 15% or more.` |

For the first three, when the accelerator pedal did reach 15%, a second sentence says so: `The accelerator pedal reached 54%.` It answers "but I did press it".

On the sample logs: 1:36, 1:40 and 1:42 pm get the first line (1:40 pm with `The accelerator pedal reached 54%.`), and 1:48 pm gets the pedal line with 14.7%.

### A log with no pull is one line (UI review, finding 15)

Three of the first four sample logs have no pull, and with a file name and a reason each they would push run A's own pull off a 900 px window.

- **Closed, which is how it starts:** one line: the title, then the length and `No pulls` in the quiet text colour: `1 min 10 s · No pulls` for the 1:36 pm sample log, which is 69.7 s long. The whole line is one button.
- **Open:** pressing the line opens the log. It then shows what any log shows (the line under the title, the file name line, `Replay`, `Rename` and `Remove`) and, in place of `No pulls`, the reason line that starts `No pulls:`. Pressing the title line again closes it.
- The button says whether the log is open (`aria-expanded`) and names what it opens (`aria-controls`).
- A log with no pull is open while it is the log in the replay, so its actions are at hand, and when its name is being edited.
- Which logs are open is not saved. A log that gains a pull after the vehicle or the rule changes is an ordinary log again.
- A log with pulls is never closed: it always shows its lines and its pulls.

### The list opens on run A (UI review, finding 15)

When the app opens, the list is scrolled so that run A's pull is in view. Only the list's own scroll box moves, never the page, and it does not animate. It happens once, after the library has loaded; it does not happen again when a log is added or a run is chosen, because the person is then looking at the list already. With no run A, nothing scrolls.

### A pull's row (UI review, finding 19)

Today the facts of a pull are one run of text that breaks wherever it runs out of room, which leaves a separator hanging at the end of a line, and `Rename` sits among the facts as if it were one.

- **Title:** as today: the pull's name, or its gear and RPM range.
- **Two lines of facts, always two:** when and how long (`at 0.2 s · 3.7 s`), then the load (`accelerator 68% · 138 kPa`). Neither line wraps. A fact the log does not have is left out with its separator; a line with nothing on it is not drawn.
- **`Rename`** sits with A, B and C at the right of the row, under them, as a text action. It is not among the facts.
- What a renamed pull shows does not otherwise change.

### Names elsewhere

The default name of a log changes everywhere it is used: the run line over the power chart, the replay's label, and the occurrences listed in a finding. `1:45 pm log` becomes `Apr 17, 1:45 pm`.

## The core

All of this is computed in `crates/core`; the UI formats and draws.

- **Start.** `logs` gives each log `startedAt`: local date and time with no zone, `2026-04-17T13:45:37`, or nothing. The date is the first part of the `Log :` header line (`20260417`). The time of day is the clock on the first data row, which is 24-hour; the header's own time is 12-hour with no am or pm and is not used.
- **Identity.** A log's `key` does not change, so saved names still match.
- **Order.** The core sorts the library as described above.
- **The rule's sentence.** `overview` carries the sentence that says what a pull is, written from the constants `detect_pulls` uses, so the sentence cannot disagree with the rule.
- **The reasons.** `overview` carries, for each log with no pull, the reason as a sentence, written from the same constants and the log's own values. The core already writes the text of findings; this follows it.
- `LogMeta.n` stays: the replay and the status line still use it.

## Edge cases

- A log with no gear channel or no speed channel reads as never in gear or never moving. The line says so in the same words; the finding that already reports a missing channel carries the detail.
- Two logs that start in the same minute have the same title. Their file name lines tell them apart.
- A header date that is not eight digits, or a first row with no clock: no `startedAt`.
- A log that runs past midnight: the start is what is shown.

## Testing

- Core: `startedAt` for each sample log (`2026-04-17T13:36:54` to `2026-04-17T13:55:10`); none for a header with no date; the order with a named file among `PCLog` files; the reason for each of the four sample logs with no pull; library tests for the remaining reason lines; the rule's sentence.
- The golden snapshot is not refreshed. New values are tested in their own file, as the switch rows are.
- UI test: titles, the line under each, the file name line, no sample count, a renamed log showing its date and time, the rule's sentence, and the reason under the 1:48 pm log.
- UI test, for the UI review's parts: a log with no pull is one line and shows no actions until it is opened; opening it shows the reason, the file name and the three actions, and its button says it is open; it is open while it is replayed; run A's pull is inside the list's box when the app opens at 1400 × 900; a pull's row has its title and two lines of facts, neither wrapped, at the rail's narrowest width, with no separator at the start or the end of a line; `Rename` is beside A, B and C.
- The website's screenshots are retaken, because the log list is in them.

## Not in this design

- Touch sizes and the `More` button that will hold `Rename` and `Remove` on a touch screen (step 4 of the UI review's order).
- The list in a narrow window, where it takes its full height in its own section (the phone and tablet layout design).
- Grouping by day. The owner chose By log.
- Sorting or filtering the list by hand.
- Notes on a log beyond its name.
- Logs for more than one vehicle. That is its own design.
