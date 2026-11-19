# Audit: design-system/typography.html (section "Typography")

Source of truth: `src/styles/globals.css` and `src/styles/*.css`, `src/components/**/*.tsx`, `src/app/not-found.tsx`.
Showcase CSS copies: `design-system/assets/css/*.css`. Line refs are `file:line`.

## Summary

| Tag | Count |
|-----|-------|
| FIX | 6 |
| SYNC | 8 |
| ADD | 3 |
| Items checked | 34 (2 stacks, 10 utilities, 7 weight rows, 9 scale rows, 3 `.money` rows, 3 header claims) |
| Consistent, no entry | 20 (2 stacks, 10 utilities, 7 weight rows, plus the NotFound row, whose cite `not-found.tsx:42` is correct) |

One item can carry more than one tag, so the findings do not add up to the item count.
`00-globals.css`, `01`-`03`, `05`, `07`-`09`, `12`-`14` are verbatim copies of `src/` after the header line.
`04-calendarview`, `10-periodsummary` and `11-plans` have drifted (see T-14).

## FIX

- **T-01 `.money` scale exists only in the showcase.**
  - Showcase: `typography.html:31-53` presents `.money-hero` 2.15rem/600, `.money-row` 0.9375rem/500, `.money-sm` 0.8125rem/500 and "no faux-bold 800/900".
  - Showcase-only CSS: `assets/css/16-standalone-html-demo-additions.css:132-157`. A `grep` over `src/` finds no `.money`, `.money-hero`, `.money-row`, `.money-sm` or `.money-currency` rule.
  - The app still ships 800/900 numerals: `globals.css:309` (`.kpi-value`), `:387` (`.donut-center-value`), `:359`, and `ExpenseForm.css:181`.
  - The same page contradicts itself: the scale table at `typography.html:30` shows the donut value at 800 and the hero input at 800.
  - `16-...css:159-172` also forces `.kpi-value`, `.donut-center-value` and the expense input to 600 and `.an-title` to 700, so the showcase renders those differently from the app.
  - Action: label the block "proposal (not in app)" and drop the overrides, or port `.money` into `src/styles/globals.css`.
- **T-02 Weights 750/800/900 are used, but the font import stops at 700.**
  - App: `globals.css:1` imports Inter `300;400;500;600;700`.
  - 800 appears in `globals.css:237,309,387,667`, `ExpenseForm.css:170,181,855`, `WeekView.css:32,186` and `AnalyticsView.tsx:296`. 900 appears at `globals.css:359` and 750 at `QuickEntry.css:36`.
  - With only a 700 face loaded these render at 700, not as the synthesized bold the page claims (`typography.html:30`, 750 and 900 rows).
  - Action: add 800 to the `@import`, or cap the app at 700 and fix the caption.
- **T-03 No size tokens, and the scale is off.**
  - There are no `--fs-*`, `--lh-*` or `--fw-*` tokens in `globals.css`.
  - `src/styles/*.css` has 285 `font-size` declarations with 56 distinct values.
  - Near-duplicates: 0.72, 0.75, 0.76, 0.78, 0.8, 0.8125, 0.82, 0.84, 0.85, 0.86, 0.875, 0.88, 0.9, 0.92, 0.95, 0.96, 0.98rem.
  - Units are mixed. px: `DayPanel.css:8,22,26`, `QuickEntry.css:8`, `Mobile.css:10`, `globals.css:342-345,359`, `CalendarView.css:426`. em: `QuickEntry.css:37`, `Mobile.css:101`, `PeriodRunway.css:25`.
  - The showcase only presents the 6 `.text-*` utilities as "the scale" (`typography.html:30`).
  - Action: define the scale tokens (about 8 steps) in `globals.css` and snap the stragglers.
- **T-04 Sub-11px text, a11y.**
  - `CalendarView.css:308` 0.58rem (9.3px) and `:274` 0.6rem (9.6px).
  - `navigation.css:366,382` 0.64rem (10.2px) for bottom-nav labels.
  - `globals.css:396` 0.65rem and `:345,359` 10px.
  - The showcase "Micro" row (`typography.html:30`) endorses these without a minimum.
  - Action: set a floor of about 11px (0.6875rem) for text that carries meaning, and document it.
- **T-05 Hard-coded type in TSX.**
  - `AnalyticsView.tsx:296` has inline `fontSize: 0.95rem` with `fontWeight: 800`, and `:302` has inline `1.25rem` overriding `.kpi-value`.
  - `not-found.tsx:34-36,42,45,57` and `(finance)/layout.tsx:399` use inline size, weight, tracking and leading.
  - The 0.875rem/700/0.15em eyebrow in `not-found.tsx:34-36` is the only 0.15em in the app, yet the showcase header cites that value without a row for it.
  - Action: move these into classes on the scale.
- **T-06 `!important` type overrides.**
  - `ExpenseForm.css:180-181` forces 2.25rem/800.
  - `PeriodSummary.css:25,27` forces 0.75rem and 400.
  - The showcase hero-input row (`typography.html:30`) hides the fact that the size only wins through `!important`.
  - Action: raise the specificity or drop the `!important`.

## SYNC

- **T-07 Header counts.**
  - The badge says "57 scale declarations" (`typography.html:30`).
  - src has 56 distinct font-size values and 285 declarations, so 57 matches neither.
  - Action: restate as "56 distinct sizes".
- **T-08 Hero Runway weight.**
  - Showcase: 2.25rem / 800 / lh 1.1 / ls -0.025em (`typography.html:30`).
  - App: `PeriodRunway.css:19` is `font-weight: 700`.
  - The ExpenseForm half of the row is right, but its cite should be `ExpenseForm.css:178-188` (`:190` is a placeholder rule).
  - Action: set the row to 700 and fix the cite.
- **T-09 Analytics / Mobile nav title.**
  - Showcase: 800, cited at `globals.css:206`.
  - App: `.an-title` is at `globals.css:237` (2rem/800/-0.02em). `.m-nav h1` at `Mobile.css:28` has no weight, so it uses the browser h1 bold of 700, with lh 1.1 and ls -0.02em.
  - Action: fix the cite and split the row into 800 for the analytics title and 700 for the mobile nav title.
- **T-10 Side Panel Hero Value.**
  - Showcase: 1.85rem / 800 / lh 1.1, cited at `PeriodSummary.css:10`.
  - App: `PeriodSummary.css:12` is 1.85rem / 700 / lh 1.15 / -0.025em.
  - Action: set the row to 700 / lh 1.15 and fix the cite.
- **T-11 Eyebrow row cites the wrong rule.**
  - Showcase cites `PeriodRunway.css:14`, which is `.runway-eyebrow` (0.8rem, no weight, no tracking, not uppercase).
  - The values shown (0.75rem / 600 / 0.08em / uppercase) are `.an-eyebrow` at `globals.css:234`, and lh 1.3 is not set there.
  - Action: cite `globals.css:234` and drop the lh.
- **T-12 Micro row cites.**
  - Showcase: "10-11px (0.58rem) / 900 / 700 / lh 1 / ls 0.03em", citing `globals.css:342,359` and `CalendarView.css:412`.
  - App: `CalendarView.css:412` is a comment, and the 0.58rem rule is at `:308`.
  - `globals.css:342` is 11px/500 and `:343` is 11px/700. The 0.02em tracking is on `.chart-ref-label` at `:345`, not 0.03em.
  - lh 1 is not set on any of the rows cited.
  - Action: split into chart axis, chart value, anomaly badge and calendar badge rows with correct cites.
- **T-13 Leading and tracking not in app source for four scale rows, plus stale cites.**
  - Auth heading: lh 1.2 is shown, none is set (`AuthScreen.css:84`).
  - Donut value: lh 1.1 is shown, none is set (`globals.css:387`).
  - Card heading: shown as lh 1.35 / ls -0.01em and cited at `globals.css:285`. The rule is `.an-card-title h3` at `:296` (1rem/700) with no lh or ls.
  - Body/List row: shown as lh 1.5 and cited at `UserProfile.css:89`. That is a nav button (0.875rem/500) with no lh. The real lh 1.5 rows are `UserProfile.css:246` and `AuthScreen.css:86`.
  - Action: use the real values and cites, or mark the lh as "inherited".
- **T-14 Showcase CSS copies are stale against `src/`.**
  - `04-calendarview.css:172-187` and `:236-244` add a `@container (max-width:140px)` block (0.875rem day total) that `src/styles/CalendarView.css` lacks.
  - `10-periodsummary.css:29-30,70-79` adds `.period-side-section h3/p` (0.68rem/0.8rem) and `.period-mini-*` (0.65rem/0.75rem). src has `.period-side-summary` instead (`PeriodSummary.css:8-10`), which the copy lacks.
  - `11-plans.css:18` adds a rule that `src/styles/Plans.css` lacks.
  - Action: re-copy these three files from `src/`.

## ADD

- **T-16 `src/styles/DayPanel.css` is absent from the showcase.**
  - No `assets/css` copy exists, and no `day-panel` rule appears on any page.
  - Missing styles: `.day-panel-net` at `DayPanel.css:8` (26px/600/-0.02em/lh 1.15/tabular), `.day-panel-tile-amount` at `:22` (14px/600), `.day-panel-tile-count` at `:26` (11px), `.day-panel-currency` at `:13` (0.6em/500).
  - It is imported by `DayPanel.tsx:19`, which is used at `CalendarView.tsx:843`.
  - Action: copy it into assets and add a "Day panel net amount" row.
- **T-17 Type roles that exist in the app but have no row.**
  - `.kpi-value` at `globals.css:309` (1.5rem/800/-0.02em).
  - `.qe-amount` at `QuickEntry.css:36` (1.95rem/750), which appears only in the weight table.
  - Base sizes: mobile 15px/lh 1.35 at `Mobile.css:10-11` and QuickEntry 14px/lh 1.35 at `QuickEntry.css:8-9`. `body` itself sets no size or leading.
  - Uppercase label pattern: `UserProfile.css:73` (0.6875rem/0.05em), `CalendarView.css:145` (0.68rem), `globals.css:614` (0.7rem/0.06em).
  - The em-relative currency suffix pattern: `PeriodRunway.css:25` (0.62em), `DayPanel.css:13` (0.6em), `QuickEntry.css:37` (0.55em), `Mobile.css:101` (0.6em).
  - Action: add rows.
- **T-18 No letter-spacing or line-height scale on the page.**
  - Tracking values in use: -0.025, -0.02 (11x), -0.015, -0.01, 0.02, 0.04, 0.05, 0.06, 0.08em.
  - Leading values in use: 1, 1.1, 1.15 (7x), 1.2, 1.3, 1.35, 1.4, 1.45, 1.5, 1.6, 1.8.
  - Only the header text mentions the ranges.
  - Action: add two small tables.

## Deferred (not tagged)

Import-AI code is absent from this branch by design:
- `src/styles/Import.css` (the showcase copy `06-import.css` is present).
- `src/lib/import`.
- `AiImportSection`, `AiModelPicker`, `ImportFlow`.
- `src/components/design-system` (showcase copy `15-designsystem.css`) and the `/design-system` route.
- The `.ds-*` classes used on this page (`ds-grid-2/3`, `ds-table`, `ds-mono`, `ds-muted`) come from `15-designsystem.css` and are defined there. They are not audited against `src/`.
