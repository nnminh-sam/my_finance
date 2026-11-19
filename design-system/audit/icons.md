# Audit: icons.html (Icons & Visual Assets)

Source of truth: `lucide-react` imports in `src/**/*.tsx` (installed 1.55.0, `package.json:24`), `public/`, `src/app`.
Showcase section: `design-system/icons.html:30` (single long line; line numbers below refer to it unless a path is given).

## Summary

| Tag  | Count | Notes |
|------|-------|-------|
| FIX  | 10    | 7 app-side inconsistencies, 1 app dead asset/comment pair, 2 showcase-side |
| SYNC | 4     | counts, alias duplicate, stale Bill-tag SVG, line refs |
| ADD  | 3     | no missing Lucide icon; missing conventions, mappings, text glyphs |

Items checked: 93 (12 category tiles, 78 UI tiles, favicon, 2 inline-SVG cards) plus 6 file:line source references.
Consistent with no entry: 82 (12 category + 68 UI tiles, favicon byte-identical to `public/favicon.svg`, Auth wallet mark path data identical to `AuthScreen.tsx:24-28`).
App reality on this branch: 80 distinct Lucide icons imported (12 category + 68 UI). Every one of the 80 is on the page, so zero ADD for icon names.
Lucide v1 `buildLucideIconNode.mjs:48` adds `aria-hidden="true"` automatically when no label is passed, so the 59 usages without an explicit `aria-hidden` are not defects. All icon-only buttons checked (shell nav, quick entry, mobile nav, DayDetails back, modal close) carry `aria-label`.

## FIX

**F-01 Period-navigation chevrons use five sizes.**
`ChevronLeft`/`ChevronRight` render at 20 (`(finance)/layout.tsx:288,294,314,320`; `mobile/MobileWeek.tsx:240-241`; `MobileAnalytics.tsx:88,90`), 22 (`MobileMonth.tsx:112,117`; `DayDetails.tsx:212`), 18 (`PlansPage.tsx:104-105`; `UserProfile.tsx:257`; `MobileMonth.tsx:178`), 16 (`IncomeSources.tsx:205,207`; `UserProfile.tsx:242`), 14 (`AnalyticsView.tsx:460`).
Showcase: chevrons shown once at 20px (`icons.html:30`, tiles) with no size guidance.
Action: pick 20 for page/period nav, 16 for inline steppers; update the app and document both.

**F-02 Close icon `X` uses four sizes.**
20 (`MonthlyIncomeModal.tsx:74`), 18 (`IncomeSources.tsx:224`, `PlannedSpendings.tsx:247`, `QuickEntryDialog.tsx:93`), 16 (`IncomeSources.tsx:308`, `PlannedSpendings.tsx:341`, `ProfileSection.tsx:10`), 15 (`QuickEntryParts.tsx:409`).
Action: dialog close = 20 or 18 in one agreed size, inline cancel/remove = 16; drop the 15.

**F-03 Other same-meaning icons drift in size.**
- Sun/Moon theme toggle: 20 (`layout.tsx:102,386`), 18 (`AuthScreen.tsx:156`), 15 (`UserProfile.tsx:401-402`).
- Plus: 16 (6 files), 20 (`layout.tsx:384`), 24 (`layout.tsx:429`).
- RefreshCw: 20 (`layout.tsx:385`) vs 16 (`UserProfile.tsx:365`).
- Trash2: 16 (`IncomeSources.tsx:355`, `McpAccessSection.tsx:341`, `PlannedSpendings.tsx:423`, `QuickEntryDock.tsx:28`, `QuickEntryDialog.tsx:130`) vs 15 (`DayDetails.tsx:329,396`).
- Pencil: 16 / 15 / 14 / 13 (`UserProfile.tsx:328`, `IncomeSources.tsx:239`, `QuickEntryParts.tsx:408`, `DayDetails.tsx:479`).
- Search: 16 / 15 / 14 / 13 (`QuickEntryParts.tsx:108`, `CategoryManager.tsx:343,310`, `AnalyticsView.tsx:496`).
- Check 16 vs 13 (`DayDetails.tsx:475`); SkipForward 16 vs 13 (`DayDetails.tsx:489,504`); ChevronDown 18 vs 13 (`QuickEntryDock.tsx:30`, `CategoryManager.tsx:336`).
Action: adopt a size scale (12 chip, 14 inline, 16 button, 18 glyph tile, 20 nav) and normalise the odd sizes 13 and 15.

**F-04 Single strokeWidth override.**
`DayPanel.tsx:57` sets `strokeWidth={2.4}` on `Plus`; the other 147 JSX usages use the default 2. The showcase tiles and demo all use 2.
Action: drop the override or document it as the "emphasis plus" exception.

**F-05 Income-source icons disagree between two components.**
`IncomeSources.tsx:33-40`: freelance=Laptop, allowance=Wallet, investment=TrendingUp. `quickEntry/QuickEntryParts.tsx:20-22`: Freelance=Coffee, Allowance=Heart, Investment=CircleDollarSign.
Action: one shared source-icon map (Laptop/Wallet/TrendingUp), used by both.

**F-06 Navigation icon inconsistency for the same destinations.**
Calendar page: `LayoutGrid` on desktop (`layout.tsx:238`) vs `CalendarDays` on mobile bottom tabs (`layout.tsx:246`). `CalendarRange` carries three meanings: Plans nav (`layout.tsx:240`), planned-spend marker (`DayDetails.tsx:257,418,451`), pay-period heading (`BudgetPeriodSection.tsx:139`, `MobileMonth.tsx:176`).
Action: use one calendar icon for the calendar page; give "planned" and "pay period" distinct icons or document the overload.

**F-07 Category icon map copied into five components.**
`ICONS = {...}` at `WeekView.tsx:19`, `DayDetails.tsx:46`, `CategoryManager.tsx:19`, `PlannedSpendings.tsx:39`, `mobile/MobileUi.tsx:11`, plus the name lists at `lib/categories.ts:6` and `server/finance/model.ts:111-114`. Default sizes also differ (`WeekView.tsx:21` = 12, `MobileUi.tsx:12` = 16, `CategoryManager.tsx:22` = 16). The page cites only the first two lists.
Action: export one `CategoryIcon` from `MobileUi`/`CategoryManager` (or `lib/categoryIcons.tsx`); showcase should reference the single source once it exists.

**F-08 Showcase `.auth-logo` demo hardcodes its background.**
`icons.html:30` sets `style="background:#2f7566"`, while the app uses `var(--auth-brand)` (`src/styles/AuthScreen.css:79`), which is `#2b605c` in the dark scheme (`AuthScreen.css:22`). The demo will not change with the theme toggle.
Action: remove the inline background so the CSS variable applies.

**F-09 Stale comment and dead asset in the app.**
`AuthScreen.tsx:20` says "deep brand blue" but the brand is jade `#2f7566`. `public/icons.svg` (Bluesky/social starter sprite) is referenced by nothing in `src/` or `public/404.html`; only the generated docs mention it. Showcase correctly calls it unused.
Action: fix the comment; delete `public/icons.svg` (or keep and leave the showcase note).

**F-10 Mixed explicit-vs-implicit `aria-hidden` style.**
Some usages pass `aria-hidden="true"` (`DayPanel.tsx:57`, `MonthlyIncomeModal.tsx:74`), 59 rely on the library default (`layout.tsx:288`, `AnalyticsView.tsx:313`, ...). Functionally equal today; the showcase tiles all show the explicit attribute.
Action: low priority; add a one-line note in the page that Lucide hides icons by default and decorative icons need no extra prop.

## SYNC

**S-01 Headline counts are wrong.**
Page: "90 Lucide icons (12 category + 78 UI)" and badge "90 Lucide icons · 1 favicon · 2 inline SVGs" (`icons.html:30`), card title "UI & Navigation Lucide Icons (78 / 78)", nav badge "90 + 3" (`icons.html:28`, repeated in all 12 showcase pages' sidebars).
App: 80 distinct icons (12 category + 68 UI) and 1 inline SVG (AuthLogo). The extra 9 icons are deferred (below); `TriangleAlert` is an alias duplicate (S-02); the second inline SVG is stale (S-03).
Action: after resolving S-02/S-03 and the deferred call, restate as 80 icons (68 UI), 1 favicon, 1 inline SVG, nav badge "80 + 2".

**S-02 Alias duplicated.** `AlertTriangle` and `TriangleAlert` are the same glyph (`lucide-triangle-alert lucide-alert-triangle` on both tiles). The app imports only `AlertTriangle` (`AnalyticsView.tsx:8`, used at `:99`).
Action: remove the `TriangleAlert` tile.

**S-03 Inline SVG #2 (Bill tag) no longer exists in the app.**
Page cites `CalendarView.tsx:893`; the file has 855 lines and no bill-tag markup. `.calendar-bill-tag` is absent from `src/styles/CalendarView.css`, but remains in the showcase copy `assets/css/04-calendarview.css:286` (stale CSS; belongs to the calendar-page audit). Only `bill` category flags remain (`src/types.ts:14`).
Action: remove the card or replace it with a current inline SVG; keep the `public/icons.svg` note.

**S-04 Line references drifted.** `(finance)/layout.tsx:336` is now `:335`; `server/finance/model.ts:113-116` is now `:111-114`. Verified correct: `categories.ts:6`, `app/layout.tsx:11`, `AuthScreen.tsx:24-28`.
Action: update the two refs.

## ADD

**A-01 No icon size or stroke convention on the page.** App sizes: 16 (43 uses), 18 (32), 15 (17), 20 (16), 13 (13), 14 (11), 12/11/22/24/17/28/40 (rare); strokeWidth default 2. Showcase shows only 18px category and 20px UI tiles. Action: add a short "Sizes in use" table (see F-01 to F-04 once normalised).

**A-02 No usage mapping for nav and income icons.** Shell nav (`layout.tsx:238-252`: LayoutGrid, List, CalendarRange, ChartColumn, User; mobile CalendarDays) and income sources (`IncomeSources.tsx:33-40`) are only listed alphabetically. Action: add two small "where used" rows after F-05/F-06 are settled.

**A-03 Text glyphs used as icons.** `✓` (`QuickEntryParts.tsx:71`, `AuthScreen.tsx:201`) and `⚠` (`charts.tsx:332`) are used in place of Lucide `Check`/`AlertTriangle`; the brand `<img src="/favicon.svg" width=40>` in `.document-brand-icon` (`(finance)/layout.tsx:335`) is not shown at its 40px app size (page shows 48). Action: add them under "Visual assets", or replace the glyphs with icons.

## Deferred (not tagged)

- Nine icons listed on the page but unused on this branch, most likely import-ai assets: `ArrowRight`, `Cpu`, `FileSpreadsheet`, `FileUp`, `Globe`, `RotateCcw`, `ShieldCheck`, `TableProperties`, `Zap`. Not found in `src/`; a repo-wide search finds them only in the showcase and `archive/`. Keep or hide until the import-ai code returns; they account for the page's 90 vs 80 gap.
- `assets/css/06-import.css` and `src/components/design-system` / `/design-system` route: not audited here.
