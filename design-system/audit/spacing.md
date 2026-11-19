# Audit: spacing.html (Spacing, Containers & Breakpoints)

Page: `design-system/spacing.html` (all content on line 30). App source: `src/styles/*.css`.
Method: counted every query and width in `src/styles/`, diffed each `assets/css/NN-*.css` copy against its source (copies add one header comment line, so their line numbers are +1).
Result: 11 of 14 copies are byte-identical to `src/`; `04-calendarview.css`, `10-periodsummary.css` and `11-plans.css` are stale. HTML markup is balanced and every `ds-*` class and token the page uses is defined.

## Summary

| Tag | Count |
|-----|-------|
| FIX | 3 |
| SYNC | 5 |
| ADD | 6 |
| Items checked | 68 (18 scale values, 7 spacing utilities, 11 container widths, 14 layout utilities, 10 `@media` rows, 4 `@container` rows, 4 header counts) |
| Consistent, no entry | 57 (scale 18, spacing utilities 7, containers 11, layout utilities 14, `@media` rows 6, `@container` rows 1) |

Scale bar widths (px/48) and container bar widths (px/1180) were recomputed and are correct. `globals.css:146-183` line range and all 14 utility line numbers match `src/styles/globals.css`. "No global `--space-*` tokens" is true (grep finds none).

## FIX

**S-01 · Breakpoints 760px and 768px disagree inside one stylesheet.**
- App: `UserProfile.css:278` and `:375` use `max-width: 760px`; `UserProfile.css:391` and the shell (`navigation.css:150`) use 768px. `MonthlyIncomeModal.css:75` also uses 760px.
- Showcase: `spacing.html:30` lists 760 and 768 as separate roles ("Profile mobile list" and "Primary mobile switch") with no warning.
- Effect: between 761 and 768px the bottom nav is active but the profile and income modal still use the desktop layout.
- Action: change the 760 queries to 768 in `UserProfile.css` and `MonthlyIncomeModal.css`, then merge the two rows on the page. If kept, note it as a known exception.

**S-02 · Off-scale hard-coded spacing values (7, 9, 11, 13, 15, 22px).**
- App: about 23 spacing declarations. Examples: `Mobile.css:80` (`padding: 9px 12px`), `DayPanel.css:19` and `:29` (`9px 10px`, `9px 4px`), `PeriodRunway.css:18` (`gap: 7px`), `globals.css:548` (`7px 10px`), `Plans.css:14` (`1px 7px`), `ExpenseForm.css:75` and `:222` (`11px`), `ExpenseForm.css:479` and `:487` (`13px 20px`), `ExpenseForm.css:795` (`20px 22px`), `AuthScreen.css:116` (`left: 15px`).
- Showcase: `spacing.html:30` presents an 18-value scale with no 7, 9, 11, 13, 15 or 22.
- Action: snap these to the nearest scale value (6/8, 10/12, 14, 24), or add them to the scale. Do not let the page claim 18 values while the app uses 24.

**S-03 · Safe-area insets are used but `viewport-fit=cover` is not set anywhere in `src/`.**
- App: `env(safe-area-inset-*)` at `navigation.css:231`, `:362`; `Mobile.css:27`; `ExpenseForm.css:735`; `QuickEntry.css:173`; `AuthScreen.css:18`, `:41`, `:42`. A grep of `src/` for `viewport` and `viewportFit` returns nothing. The viewport is probably defined elsewhere (for example the Next.js default), so confirm before changing.
- Without `viewport-fit=cover` every inset resolves to 0.
- Action: verify the root layout viewport export. If it is missing, add `viewportFit: 'cover'`.

## SYNC

**S-04 · Row `min-width: 1280px` is stale.**
- Showcase: `spacing.html:30` says "Pins `.calendar-summary-side` (320px)", cited as `CalendarView.css:511`. The copy `assets/css/04-calendarview.css:512` pins it to the right at 1280px and above.
- App: no 1280px query exists. The summary and day panel now sit on the left from 769px and up, at `CalendarView.css:410-425` (`left: 0`, `width: var(--calendar-side-width)`, `border-width: 0 1px 0 0`).
- Action: replace the row with `min-width: 769px` "desktop calendar table + left 320px panel" (see S-09) and refresh `04-calendarview.css`.

**S-05 · Container query `max-width: 140px` is stale; the app uses 72px.**
- Showcase: `spacing.html:30` row "Compact calendar day cell labels", cited as `CalendarView.css:171` (copy `:172`).
- App: `CalendarView.css:467` has `@container (max-width: 72px)` (inside the 769px block), which swaps `.calendar-net-full` for `.calendar-net-short`. The 140px rule is gone.
- Action: change the query to 72px and the behaviour to "net amount switches to short form".

**S-06 · Line citations drifted from `src/`.**
- 480px: page cites `CalendarView.css:442`; app is `:329`.
- 768px: page cites `CalendarView.css:336, 555`; app is `:232, 398`.
- 768px: page cites `Plans.css:23`; app is `:22`.
- Container 620px: page cites `PeriodSummary.css:60`; app is `:59`.
- Container 1000px: page cites `PeriodSummary.css:57`; app is `:56`.
- Action: update the citations.

**S-07 · Header counts are wrong after S-04 and S-05.**
- Showcase: `spacing.html:30` says "10 `@media`", "9 width breakpoints + reduced-motion", and the badge says "14 queries".
- App: the width breakpoints are 420, 480, 560, 640, 760, 768, 769 and 1100. That is 8, plus reduced-motion, so 9 `@media` rows. The 4 `@container` rules are unchanged, giving 13 queries.
- Action: set the counts to 8 width breakpoints, 9 `@media` and 13 queries. Update the "320px–1180px" badge only if the container range changes.

**S-08 · Stale CSS copies carry old spacing rules.**
- `assets/css/10-periodsummary.css` vs `src/styles/PeriodSummary.css:8-10`: the copy has `.period-side { gap: 14px; padding: 16px }`. The app has `gap: 0; padding: 0` and adds `.period-side-summary` (gap 14, padding 16) and `.period-side-note` (padding `0 16px 12px`). The copy also keeps `.period-mini*` rules (about 10 lines) that no longer exist in the app.
- `04-calendarview.css`: the whole 769px desktop block (`CalendarView.css:404-471`) and `.calendar-day-net` are missing. It still carries the old `.calendar-spending-*` rules and the 1280px query.
- `11-plans.css`: one extra line, `.calendar-spending-row-planned.is-sure` (the app dropped it).
- `DayPanel.css` (39 lines, with spacing: `.day-panel` padding `14px 12px 0`, tiles gap 6px) has no copy in `assets/css/`.
- Action: re-copy these three files and add `DayPanel.css`.

## ADD

**S-09 · `min-width: 769px` desktop calendar breakpoint is not documented.**
- App: `CalendarView.css:410`. It sets `.calendar-container { padding: 0 0 0 var(--calendar-side-width); gap: 0 }`, a 28px week-number column plus a 7-column table (`:425`, `:430`), a 1px-gap hairline grid (`:429`), and a day-cell padding of `8px 10px 10px` (`:436`).
- Showcase: the 769px row (`spacing.html:30`) cites only `navigation.css:405` ("Desktop shell header restoration").
- Action: add `CalendarView.css:410` as a source and mention the desktop calendar table and the left panel.

**S-10 · 768px sources missing from the row.**
- App: `CalendarView.css:232` and `:398`; `ExpenseForm.css:1126` (the page lists only `ExpenseForm.css:1008`).
- Action: add them (the page already lists `UserProfile.css:391` and `globals.css:180`).

**S-11 · Safe-area insets have no entry.**
- App: 8 sites listed in S-03, all fixed offsets plus `env(safe-area-inset-*)`, for example `calc(6px + env(safe-area-inset-bottom, 0px))` (`navigation.css:231`) and `max(24px, env(safe-area-inset-top))` (`AuthScreen.css:18`).
- Showcase: nothing. The page has no row for them even though the task's source of truth includes them.
- Action: add a short "Safe-area" card listing the sites and the pattern.

**S-12 · Page and shell gutters are not shown.**
- App: `.document-header` `padding: 16px 24px` (`navigation.css:15`), mobile `8px 12px` (`:155`), `.calendar-container` `padding: 16px; gap: 16px` (`CalendarView.css:2`), `.week-container` `padding: 12px 14px; gap: 12px` (`WeekView.css:7`), `.m-pad` `0 12px 16px` (`Mobile.css:24`), `.m-nav` `16px` sides (`:27`).
- Showcase: only max-widths, no padding or gutter rows.
- Action: add a "Shell gutters" table.

**S-13 · Height caps and popover widths are missing from the containers list.**
- App: modal height caps `92dvh` (`ExpenseForm.css:649, 731`), `90dvh` (`MonthlyIncomeModal.css:5`), `94dvh` (`QuickEntry.css:163`), `.qe-dialog max-height: min(760px, 100%)` (`:127`). Popover widths: `.cat-merge` 260px (`UserProfile.css:241`), `.cat-confirm` 300px (`:245`), `.cat-look` 290px (`:248`), `.donut-legend` `max-width: 360px` (`globals.css:389`).
- Showcase: widths only for the 11 listed containers.
- Action: add rows (optional, low priority).

**S-14 · 1px hairline gap is outside the scale.**
- App: `gap: 1px` in the desktop calendar (`CalendarView.css:425, 429, 430`), and many other declarations use 1px in padding or gap.
- Showcase: the scale starts at 2px.
- Action: add 1px as a "hairline" step or note it as an exception.

## Deferred (import-ai, not tagged)

- `Import.css:306` (a 768px source) and `Import.css:155` (a reduced-motion source) are cited in the page, but the file is absent on this branch.
- The `.import-card` half of the `min(880px, 100%)` container row (`.qe-dialog` is real and matches `QuickEntry.css:127`).
- `assets/css/06-import.css` is linked by `spacing.html:14`; `assets/css/15-designsystem.css` (own breakpoints 960 and 600, not from `src/`) pairs with the deferred `src/components/design-system` and the `/design-system` route.
- The page-header text "15 plain stylesheets" and "63 exported symbols" (`spacing.html:27`) belong to the deferred design-system code; not audited here.
