# Audit: colors.html ("Color Tokens & Palettes")

Page body is one physical line (`colors.html:30`); citations below name the visible string instead of a line.
App source of truth: `src/styles/globals.css` (`:root` 3-43, `.light-mode` 95-120, `--accent` 189-190).
`assets/css/00-globals.css` is byte-identical to `src/styles/globals.css` apart from its 1-line banner (diffed, no drift).

## Summary

| Tag  | Count |
|------|-------|
| FIX  | 10    |
| SYNC | 3     |
| ADD  | 2     |

Checked and consistent (no entry): 29 global tokens (all dark+light values and both globals.css line refs; count badge "29 global" is right: 6+2+7+8+6),
18 of 23 scoped tokens (AuthScreen 7, M 2, QE 3, Profile 2, Runway 4; values and line refs match), the 12 `.bg-cat-*/.text-cat-*` class names and range
`globals.css:131-143`, 3 swatch arrays (CATEGORY_SWATCHES 9, FALLBACK_COLORS 7, SOURCE_COLORS 7), 6 server-default vs `--cat-*` rows (values correct),
7 hard-coded literal rows and 5 backdrop rows (file:line verified). About 80 entries checked. Radius tokens (`--radius-*`) are not on this page but are shown in `elevation.html`, so not an ADD.
Showcase scope helpers (`.ds-token-scope.auth-screen` etc. in `15-designsystem.css:376-396`) correctly neutralise the app layout rules.

## FIX

**C-01 Callout "v2 Fixed - 0 Divergences" is false.**
Showcase: callout above CATEGORY_SWATCHES says model.ts defaults are "reconciled 1:1 with --cat-*" and green is "removed from expense categories". The table 20 lines below it marks Food, Shopping, Bills, Other as "Diverges" (4 of 6).
App: `src/server/finance/model.ts:123-128` still seeds Food `#10b981`, Shopping `#f59e0b`, Bills `#ef4444`, Other `#6b7280` vs `globals.css:33-38`; `src/lib/categories.ts:5` still offers `#10b981` as an expense swatch.
Action: either align model.ts to `--cat-*` (then drop the "Diverges" rows) or reword the callout to "4 divergences remain".

**C-02 Light-mode `--danger` is not overridden and fails AA as text.**
App: `globals.css:20` only; `.light-mode` block (95-120) has no `--danger`. `#ef4444` is 3.76:1 on `--bg-card` and 3.42:1 on `--bg-main`. Used as text in `Alert.css:25,40`, `ExpenseForm.css:463,529,580,846,865`; white-on-danger `Mobile.css:79` is 3.76:1.
Precedent: `AuthScreen.css:24` already uses `#dc2626` (4.83:1) in light mode.
Showcase: row `--danger` says "Light: #ef4444 (inherited)" with no warning.
Action: add `.light-mode { --danger: #dc2626 }` (or darker) in globals.css, then update the showcase row to `globals.css:20, <new line>`.

**C-03 `--forecast` is below AA as text in light mode (and borderline in dark).**
App: `globals.css:28` dark `#73817c` = 4.42:1 on `--bg-card`; `globals.css:115` light `#7b8798` = 3.65:1 on card, 3.32:1 on `--bg-main`. It is used as text colour for planned amounts: `Mobile.css:162,170`, `DayPanel.css:11,25,38`, `CalendarView.css:105,148,378,465`, `WeekView.css:304`.
Showcase: `--forecast` row shows both values with no contrast note.
Action: darken light `--forecast` to roughly `#66718a` or lower (>=4.5:1) and lift dark slightly; or stop using it for text.

**C-04 Light `--text-muted` and `--warning` just under AA on tinted surfaces.**
App: `globals.css:100` `#64748b` = 4.33:1 on `--bg-main`, 4.34:1 on `--bg-card-hover` (176 text uses); `globals.css:109` `#a8650f` = 4.21:1 on `--bg-main`. Both pass on pure `--bg-card` (4.76 / 4.63).
Action: nudge light `--text-muted` to about `#5b6b80` and `--warning` to about `#9a5a0b`; low priority.

**C-05 White text on `--qe-income` is 1.9:1 in dark mode.**
App: `QuickEntry.css:6` `--qe-income: var(--success)` (dark `#6fcdb3`); `QuickEntry.css:33` and `:153` set `color: #fff` on it. Light mode is fine (5.19:1).
Showcase: scoped row `--qe-income` ("Dark: var(--success)") hides this; the page also lists `.qe-mode/.qe-btn.is-income` among the harmless `#fff` literals.
Action: use `color: var(--on-primary)` for these two rules.

**C-06 Off-palette hard-coded indigo.**
App: `ExpenseForm.css:297` `.expense-input-leading-icon { color: #6366f1 }`. No indigo exists in tokens; `--accent`/`--text-muted` are the system choices.
Showcase: listed in "Hardcoded Literal Usage" (correct) but presented as accepted.
Action: replace with `var(--text-muted)` (or `--accent`) in the app, then drop the row.

**C-07 Five different modal scrims, no token.**
App: `Alert.css:6` `rgba(0,0,0,.45)`; `MonthlyIncomeModal.css:18` `.5`; `QuickEntry.css:125` `rgba(9,9,11,.5)`; `ExpenseForm.css:550` `.55`; `ExpenseForm.css:662` `.6`.
Showcase: "Backdrop Overlay" table catalogues them verbatim (accurate).
Action: add one `--scrim` token in globals.css and use it everywhere; collapse the table to one row.

**C-08 `--cat-*` tokens and `.bg-cat-*/.text-cat-*` utilities are dead code.**
App: `globals.css:33-38, 130-143`. No `.tsx` references the classes and no `var(--cat-*)` exists outside those utility rules; categories render from server colours (`model.ts:123`, `MobileUi.tsx:18`, inline `meta.color`).
Showcase: page presents them as the live category system.
Action: delete the utilities (or wire categories to them); until then label the section "legacy / unused".

**C-09 Showcase utility pills put white text on yellow.**
Showcase: the `.bg-cat-Bills` pill under "Category Utility Classes" uses inline `color:#fff` on `#eab308` = 1.92:1 (Food 3.67:1 is also under AA for 12px text).
Action: switch the pill text to `var(--on-primary)` or a dark ink for Bills (showcase-only edit).

**C-10 `--accent` row contradicts another showcase page and the stated palette rule.**
App: `globals.css:189-190` dark `#a78bfa`, light `#7c3aed` (violet; used by charts and analytics, 21 uses), while `globals.css:22-23` says colour is kept only for money meanings. The colours page matches the app.
Showcase: `v2-fixes.html:62,67` claims accent was "muted to jade-teal (#5eb8a0)" and `--cat-*` matches 1:1; neither is true in `src/`.
Action: correct v2-fixes.html (other page's owner), and decide whether to retire violet in the app.

## SYNC

**S-01 model.ts line range is wrong.** Showcase table header: "Category Server Default (model.ts:126-131)". App: `src/server/finance/model.ts:123-128`. Action: update the citation.

**S-02 Stale stylesheet copies feeding the colour demos.**
Showcase `assets/css/04-calendarview.css` lacks the src day-net colour rules (`CalendarView.css:445,449,463-465`: `.is-in` money-income, `.is-over` money-over, `.is-plan` forecast, selected ring) and has older rules src no longer has; `10-periodsummary.css` has the pre-redesign `.period-side` (src `PeriodSummary.css:8-9`); `11-plans.css:19` has `.calendar-spending-row-planned.is-sure` that `src/styles/Plans.css` no longer has; no copy of `src/styles/DayPanel.css` exists (uses `--forecast`, `--money-income`, `--money-over`, `--on-primary`).
Action: re-copy CalendarView/PeriodSummary/Plans and add `DayPanel.css` as a new chunk (`assets/css/NN-daypanel.css`) and link it from colors.html.

**S-03 Badge "5 TS/CSS palettes" does not match the page.** Page renders 3 swatch palettes + 3 tables (server defaults, literals, backdrops). Action: reword to "3 palettes + 3 literal tables" or restructure.

## ADD

**A-01 Runtime-set colour custom properties are not documented.**
App: `--c` (set inline in `MobileWeek.tsx:292,329,341,356,464`, `MobileMonth.tsx:176`, `QuickEntryParts.tsx:130,405`; consumed `Mobile.css:83,107,108,168`, `QuickEntry.css:48,49,98`) and `--runway-color` (`PeriodRunway.tsx:166` -> `PeriodRunway.css:54`).
Action: add a short "Runtime-injected" card under Component-Scoped properties (non-colour `--weeks`, `--calendar-side-width` belong to the spacing page).

**A-02 More `#10b981` literal fallbacks not catalogued.**
App: `QuickEntryParts.tsx:401` (income source fallback), `src/server/mcp/tools.ts:51,714` (MCP default category colour). The page's literals table omits them, yet they contradict "green reserved for income" (see C-01).
Action: add rows (or fix the sources).

## Deferred (import-ai work, not tagged)

- Five `--imp-sunken/-soft/-ok/-warn/-bad` scoped rows (`Import.css:6-10`, selectors `.import-page, .ai-picker, .ai-cards, .ai-import-form`) and the page badge "23 scoped": on this branch only 18 exist.
- Literals table row `#64748b` cites `ImportParts.tsx:231-232` (ImportFlow area; file absent from `src/`).
- `assets/css/06-import.css` chunk and the `.ds-token-scope.import-page` helper (`15-designsystem.css:378`) exist only for the above.
- `src/components/design-system` and the `/design-system` route were not consulted.
