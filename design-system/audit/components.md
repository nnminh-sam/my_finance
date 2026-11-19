# Audit: components.html ("Pure & Overlay Components")

Scope: `design-system/components.html` vs `src/components/*`, `src/contexts/DialogContext.tsx`, `src/app/not-found.tsx`, `src/styles/*.css`.
Method: read the page markup (the section is 3 very long lines, 30/46/59; cited below by card name), compared class names, structure, aria and copy with the JSX; diffed every shared stylesheet copy against `src/styles`; diffed class lists page-vs-CSS.

## Summary

| Tag | Count |
|---|---|
| FIX | 8 |
| SYNC | 7 |
| ADD | 6 |

Components checked: 15 entries on the page (13 in scope + 2 deferred). 4 fully consistent (Money, RunwayBar, EditorActions, AuthWaiting). Also checked and consistent: `shortMoney` formatting in the strip legend (14,2M / 7,85M / 2,25M / 32,5M / 631k), `runwayHeadline` copy, bar `aria-label` strings, `data-seg` attributes, "13 days" arithmetic, `Left`/`Over by` strip labels, `aria-expanded`/`aria-label` on `.m-info`, EditorActions idle and busy ("Saving…") states.

## Per-component status

| Component | Status | Findings |
|---|---|---|
| SystemAlert & DialogProvider | FIX + SYNC + ADD | K-01, K-04, K-05, S-06, A-04 |
| Toast | SYNC + ADD | S-07, A-05 |
| InfoCard | FIX + ADD | K-03, A-05 |
| EditorActions | ok | - |
| CategoryGlyph & CategoryIcon | FIX (app) | K-06 |
| Money | ok (app note) | K-08 |
| RunwayBar | ok | - |
| PeriodRunway | FIX + SYNC + ADD | K-02, S-04, A-03 |
| PeriodSidePanel | SYNC + ADD | S-01, S-02, S-03, A-02 |
| PeriodStrip | FIX + ADD | K-03, K-07, A-02 |
| AuthWaiting | ok | - |
| NotFound card | SYNC | S-05 |
| AiModelPicker, ImportParts | Deferred | see Deferred |
| DayPanel (not on page) | ADD | A-01 |
| QuickEntry Dock/Keypad/panels/Dialog (not on page) | ADD | A-06 |

## FIX

- **K-01 SystemAlert / Toast triggers (showcase)**: the four "Trigger ..." buttons and "Show Live Toast" use `.profile-button*`, but those rules are scoped `.user-profile .profile-button` (`src/styles/UserProfile.css:122,138,140`; the showcase copy has no unscoped rule, `grep` of `assets/css` confirms). Page: components.html:30, first card `.ds-prim-row` and second card first row; only the EditorActions row sits inside `.user-profile`. Buttons render unstyled. Action: wrap in `.user-profile` or add a `.ds-prim-row .profile-button` rule in 16-standalone css.
- **K-02 PeriodRunway labels overlap (showcase)**: all `.runway-label` carry the SSR-frozen `style="left:0px"` (3 cards: healthy, over, zero income) while `.runway-label{position:absolute}` (`src/styles/PeriodRunway.css:54`; positions come from `placeLabels` at `PeriodRunway.tsx:132,166`). Labels stack on top of each other. Action: set real `left` px per label (e.g. 0 / 38% / 66% of the row) or use `.runway-labels-stack`.
- **K-03 InfoCard and PeriodStrip Details do nothing (showcase)**: copy says "Click the ⓘ icon to toggle the explanation panel" but `assets/js/design-system.js` has no handler for `.m-info` or `.period-strip-details` (grep: 0 hits); real behaviour at `MobileUi.tsx:73-75` and `PeriodSummary.tsx:120-134`. Action: wire both toggles (render `.m-info-text` / `.period-strip-grid`) or drop the instruction text.
- **K-04 Modal demo is not the SystemAlert contract (showcase)**: `components.html:46` wraps `.m-alert` in `role="dialog"` backdrop; inner `.m-alert` has no `role="alertdialog"`/`aria-label` (`SystemAlert.tsx:55`); no Escape-to-dismiss or initial focus (`SystemAlert.tsx:21-44`, JS has no keydown); "Trigger Destructive" confirm stays `is-primary` instead of `.is-destructive` (`design-system.js:256-258` vs `SystemAlert.tsx:66`); "Direct Vertical SystemAlert" never adds `.is-vertical` to `#ds-demo-modal-actions` (`design-system.js:266`, `Alert.css:30`). Action: set classes/roles per trigger, add Escape + focus.
- **K-05 SystemAlert double dialog semantics (app)**: `<dialog aria-label={title}>` (`SystemAlert.tsx:51-53`) contains `<div role="alertdialog" aria-modal="true" aria-label={title}>` (`:55`): nested, identically-labelled dialogs; screen readers can announce the title twice. Action: keep the label on one element only.
- **K-06 Category icon rendered two ways (app)**: `CategoryIcon` (`MobileUi.tsx:10-14`) and `CategoryGlyph` (`CategoryManager.tsx:19-27`) each hold their own `ICONS` map; the same 12-icon map is also copied at `PlannedSpendings.tsx:39`, `WeekView.tsx:19` and `DayDetails.tsx:46`. Adding an icon requires 5 edits. Action: one shared `categoryIcons` module; `CategoryGlyph` wraps `CategoryIcon`.
- **K-07 PeriodStrip Details a11y gap (app)**: button has `aria-expanded` (`PeriodSummary.tsx:120`) but no `aria-controls`, and the revealed `<dl class="period-strip-grid">` (`:127`) has no id. Action: add id + `aria-controls`.
- **K-08 Currency glyph two ways (app, low)**: `Money` emits `runway-money` + `runway-currency` (`PeriodRunway.tsx:17`) while DayPanel hand-rolls `day-panel-currency` (`DayPanel.tsx:32`); `shortMoney` falls back to `"N ₫"` with a space (`PeriodRunway.tsx:25`). Action: reuse `Money` (a `currency` class prop) or document the split.

## SYNC

- **S-01 PeriodSidePanel is a stale design (showcase)**: card "PeriodSidePanel (with MiniCalendar)" renders a `ds-v2-daily-hero` "Safe to spend today" block, `period-side-section period-mini` calendar ("Pay cycle window"), "Pace vs. Today" and "Coming up · Next 7 days". None exists in the app: `PeriodSummary.tsx:53-99` has headline (`period-side-sub` "630.769 ₫ a day for 13 days"), bar, rows `dl`, and `props.children`; CalendarView passes the pay-cycle hint note plus `DayPanel` (`CalendarView.tsx:841-852`). `grep -rniE "safe to spend|pace vs|coming up|MiniCalendar|period-mini" src` finds nothing. Showcase also lacks the `.period-side-summary` wrapper (`PeriodSummary.tsx:64,96`) and uses showcase-only `.money/.money-sm/.money-currency` (16-standalone css:153). Action: rebuild the card from the JSX; drop the v2 blocks and rename the card.
- **S-02 Stale shared CSS copies (showcase)**: `assets/css/10-periodsummary.css` differs from `src/styles/PeriodSummary.css` (18 lines): app `.period-side{gap:0;padding:0}` + `.period-side-summary` + `.period-side-note` (`PeriodSummary.css:8-10`) vs showcase padding 16/gap 14 and extra `.period-side-section*`, `.period-mini*`. Same drift off-page: `04-calendarview.css` (236 differing lines, e.g. `.calendar-day-total-desktop` and the `@container (max-width:140px)` block exist only in the copy) and `11-plans.css` (extra `.calendar-spending-row-planned.is-sure`). Action: re-copy the three files from `src/styles`.
- **S-03 Stale source refs and counts (showcase)**: "PeriodSummary.tsx:116" and ":169" (card heads) now point elsewhere: `PeriodSidePanel` is `PeriodSummary.tsx:53`, `PeriodStrip` `:104`; `AuthScreen.tsx:44-54` is correct; not-found ref "21-63" now spans `not-found.tsx:13-64`. The SystemAlert card cites `SystemAlert.tsx` for "DialogProvider" but that lives in `src/contexts/DialogContext.tsx:39`. Section badge "16 pure components · 30 groups" is not derivable from the page (15 entries). Action: update refs, recount the badge.
- **S-04 PeriodRunway eyebrow copy (showcase)**: "Healthy Budget · Current Period", "Over Budget · Hatched Overflow", "Zero Income State" are invented labels; the app heading is `Until 5 Dec · <period>` / `This period · <period>` (`PlansPage.tsx:118`) then " · Day N of M" (`PeriodRunway.tsx:143`). Action: use real heading strings and put state names in the card head.
- **S-05 NotFound card (showcase)**: app uses `<div>` + `<main class="glass">` with `max-width:34rem`, `clamp()` padding, `<h1>` and `<Link href="/">` (`not-found.tsx:13-22,47-58`); showcase uses `max-width:30rem`, fixed padding, `<h4>` and a `<span>` for "Back to home" (components.html:30, last card). Action: mirror the 34rem width and render the CTA as `<a href="/">` (keep heading level a documented exception).
- **S-06 SystemAlert static anatomy and copy (showcase)**: static `.m-alert` has no `.m-alert-layer` parent, no `role="alertdialog"`/`aria-label` (`SystemAlert.tsx:50-56`); default confirm label in the app is "OK" (`DialogContext.tsx:84`), showcase says "Confirm"; prompt input is labelled by the title (`DialogContext.tsx:110`), showcase hard-codes "Category label". Action: align roles and default copy.
- **S-07 Toast demo (showcase)**: "Show Live Toast" shows `#ds-demo-toast` (`components.html:59`, `.ds-demo-toast` pill with a ✕ close button, 16-standalone css) rather than the app's `.m-toast` (`Mobile.css:117-120`, Undo only, auto-hide 3800 ms in `MobileUi.tsx:28`). Action: reuse `.m-toast` with the stage container and Undo only.

## ADD

- **A-01 DayPanel**: `src/components/DayPanel.tsx` + `src/styles/DayPanel.css` appear on no page and no `assets/css` copy exists (`grep DayPanel` over all showcase html/css: 0). States to show: tones `is-in/out/plan`, over-budget suffix (`DayPanel.tsx:52-54`), kind tiles with `aria-pressed`, empty "Nothing on this day" (`:77`), `is-button` rows, `is-expected`. Action: add `12b-daypanel.css` copy and a card (also place it inside the S-01 side panel).
- **A-02 PeriodStrip / PeriodSidePanel states**: not shown: strip expanded `period-strip-grid` (`PeriodSummary.tsx:127-133`), strip/side over ("Over by", `runway-swatch-over`) and no-income ("Income not set" + link in `.period-side-sub a`), `.period-side-zero` dimmed rows, committed/estimates hidden when 0 (`:115-116`), `.period-side-note` hint. Action: add over / no-income / zero variants.
- **A-03 PeriodRunway variants**: not shown: `compact` and `stack` label modes (`.runway-labels-stack`), edge marks `.runway-mark-start/-end` (`PeriodRunway.tsx:29`), headline for upcoming/past ("Starts ..."/"Ended ...", `:42-43`), "Spent more than income by" (`:36`), `EMPTY` foot copy "Nothing spent yet / No estimates" (`:11`). Action: add a stack-mode and a past-period example.
- **A-04 SystemAlert variants**: classes never rendered on any page: `.is-destructive`, `.is-vertical`, `.m-alert-layer`, `.income-sheet-source/-fields/-error` (`Alert.css:20,30,36-42`; `IncomeRecordSheet.tsx:64-82`). Action: add static destructive, vertical and income-sheet (prompt with `.m-alert-input`) examples.
- **A-05 Toast / InfoCard variants**: `.m-toast.is-top` and the empty (not `is-on`) state (`MobileUi.tsx:50`); InfoCard open state with `.m-info-text` and `right` slot (`:67-74`). Action: add both.
- **A-06 QuickEntry pieces**: 41 of 51 `qe-*` classes used by `QuickEntryDock/Parts/Dialog` have no markup on any page (e.g. `qe-keys`, `qe-dock-h`, `qe-dialog`, `qe-panel`, `qe-queue`, `qe-stepper`, `qe-tray`); workbench only opens a stub modal with an `.m-alert-input` (`design-system.js:222-229`). Exports without entries: `Keypad`, `AmountDisplay`, `CategoryGrid/Chips`, `RepeatPanel`, `QueueList`, `QuickEntryDock`, `QuickEntryDialog`. Action: static dock + dialog + keypad cards.

Checked, no ADD needed: CalendarView, WeekView, DayDetails, CategoryManager, IncomeSources, PlannedSpendings, BudgetPeriodSection, McpAccessSection, IncomeRecordSheet, PlansPage, AnalyticsView, MobileMonth/Week/Analytics, MonthlyIncomeModal (all have a `workbench.html` panel or inventory row); `ProfileSection` = EditorActions (shown here); `FinancePageViews.tsx` and navigation (`layout.tsx`, `navigation.css`; workbench "6 Navigation Sections") are routing glue. AuthScreen form states (field errors, banner, caps lock) are on primitives.html, not this page.

## Deferred (import-ai, intentionally absent from this branch)

- `AiModelPicker` (menu and cards layouts; card "PeriodStrip & AiModelPicker", ref `AiModelPicker.tsx:81`), `ai-*` styles, `aria-controls` ids.
- `ImportParts` card (SampleTable, ManualGrid, ImportReview; ref `src/components/import/ImportParts.tsx`), `.import-*` classes, `assets/css/06-import.css`, `is-expense`/`ai-trigger` classes with no CSS in the showcase.
- `assets/css/15-designsystem.css` / `src/components/design-system` and the `/design-system` route.
- Once import-ai lands, split the AiModelPicker block out of the PeriodStrip card.

## Process note

One read-only `git log -1` was run by mistake while searching; no files other than this report were written.
