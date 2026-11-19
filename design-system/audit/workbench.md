# Audit: workbench.html (Interactive Feature Workbench & Modals)

Scope: `design-system/workbench.html` vs `src/components/*`, `src/app/(finance)/layout.tsx`, `src/lib/navigation.ts`, `src/styles/*.css`.
Paths below: `WB` = design-system/workbench.html, `JS` = assets/js/design-system.js, `L` = src/app/(finance)/layout.tsx, `CSS-x` = design-system/assets/css/x.

## Summary

| Tag | Count |
|---|---|
| FIX  | 7 |
| SYNC | 24 |
| ADD  | 11 |
| Deferred (not counted) | 6 |

Surfaces checked: 23 = 18 `data-wb-tab` panels + 4 modal triggers + the shared nav shell (header and bottom nav are tab 18).
Consistent items (no entry): 22. They are: shell nav labels and order (5 desktop + 5 bottom), `aria-current` usage, `.glass` classes, header/bottom-nav class names that exist in both, `navigation.css` byte-identical (only a banner comment added), 10 other stylesheets byte-identical (WeekView, UserProfile, QuickEntry, MonthlyIncomeModal, Mobile, Alert, PeriodRunway, AuthScreen, ExpenseForm, globals), tab count 18 matches the badge and sidebar "18 + 3", inventory row count (30) matches its title, `.document-basis-toggle` markup (`role=group`, `aria-label="Calendar pages"`, Month/Pay cycle) matches L:367-370.

## Per-surface status

| # | Surface (tab) | Status | Findings |
|---|---|---|---|
| 1 | quick-entry (QuickEntryDock) | drifted | W-12 |
| 2 | auth (AuthScreen) | drifted | W-13 |
| 3 | profile (UserProfile) | drifted | W-14 |
| 4 | categories | stub | W-15 |
| 5 | income | stub | W-16 |
| 6 | paycycle | drifted | W-17 |
| 7 | ai-mcp | drifted (AI half deferred) | W-18 |
| 8 | planned | drifted | W-19 |
| 9 | plans | drifted | W-20 |
| 10 | import | deferred | D-1 |
| 11 | calendar | stale layout | W-08, W-09, W-31 |
| 12 | week | drifted + invented data | W-21 |
| 13 | day (DayDetails) | stub | W-22 |
| 14 | analytics | stub | W-23 |
| 15-17 | mobile-month / week / analytics | text stubs | W-24, W-05 |
| 18 | shell (header, bottom nav) | drifted | W-01, W-02, W-10, W-11, W-25, W-26, W-27 |
| M | modals (4 triggers) | drifted | W-03, W-28, W-29, W-30 |
| - | Inventory table (WB:453) | missing DayPanel row | A-11 |

## FIX (inconsistent or wrong)

- **W-01 FIX, shell nav: Plans is on the desktop nav but not on the mobile bottom nav.** App: L:237-243 `navigation` has 5 items (Calendar, Week, Plans, Analytics, Profile). L:245-254 `bottomTabsLeft/Right` has Month, Week, +Add, Analytics, Profile. Plans is reachable on phones only through the MobileMonth "Plans" row (MobileMonth.tsx:175). Showcase repeats the split (WB:414-420 vs WB:439-448). Action: decide the intended mobile entry point for Plans before the redesign and make both lists agree (or document the exception).
- **W-02 FIX, nav model duplicated and not in `src/lib/navigation.ts`.** navigation.ts has only `pageHref/readPageDate/safeReturnPath/authHref` (navigation.ts:5-39) and no item list. Items, labels and icons are inline in L:237-254 and paths in src/lib/pages.ts:2-10. The labels diverge between desktop "Calendar" (LayoutGrid, L:238) and mobile "Month" (CalendarDays, L:246). The two shared route arrays are re-spelled in 3 places. Action: export one `NAV_ITEMS` (with a `bottom` flag and label override) from navigation.ts and render both navs from it.
- **W-03 FIX, demo modal a11y.** `#ds-demo-modal-backdrop` carries `role=dialog aria-modal` on the backdrop (WB:455), not on the panel. JS:200-232 has no focus move, no focus trap, no Escape and no focus restore. App: MonthlyIncomeModal.tsx:46-62 uses native `<dialog>.showModal()`, QuickEntryDialog.tsx:73-81 traps Tab. Action: move the role/aria to `.m-alert`, add Escape and focus handling in the JS.
- **W-04 FIX, workbench tablist is not an accessible tabs pattern.** WB:45-64 has `role=tab` buttons without `id/aria-controls` or roving `tabindex`. Panels (WB:68, 106, ...) have no `role=tabpanel/aria-labelledby`. JS:178-192 has no arrow-key handling. App pattern: UserProfile.tsx:281-300 (`aria-orientation`, `aria-controls`, `tabIndex`, `onKeyDown`). Action: add ids/controls/roles and arrow keys, or drop `role=tab`.
- **W-05 FIX, `.m-seg` tablist buttons lack `role=tab`.** WB:390-394 has `role=tablist` with `aria-selected` buttons and no tab role and no `aria-label`. App: MobileAnalytics.tsx:95-100 has `role=tablist aria-label="Analytics section"` and `role=tab`. Action: add the roles and the label.
- **W-06 FIX, undefined class and heavy inline styling.** `.ds-grid-4` is used at WB:260 but is not defined in any of the 17 stylesheets (the inline `style` supplies the grid). The QuickEntry keypad (WB:90-95) re-implements the pad with an inline grid instead of `.qe-keys` (see W-12). Action: define `.ds-grid-4` or remove it, and use real component classes.
- **W-07 FIX, preview nav items are non-focusable spans carrying `aria-current`.** WB:415-419 and WB:440-447 use `<span class="document-nav-link"/document-bottom-link">` (the app uses `<Link>` anchors, L:352-361, 410-421). `:hover/:focus-visible` styling in navigation.css:125-131 never applies. Action: use `<a href="#" aria-disabled>` or add `tabindex=-1` plus a note that the nav is a static preview.

## SYNC (showcase drifted from app)

### Calendar and shell

- **W-08 SYNC, calendar panel is an older, invented layout.** App: CalendarView.tsx:679-851 renders `.calendar-container > PeriodStrip + .calendar-weekdays-grid + .calendar-days-grid > .calendar-month-page > .calendar-week-row/.calendar-week-number/.calendar-day-header/.calendar-day-net` and a left-pinned `PeriodSidePanel` holding `DayPanel` (CalendarView.tsx:841-851; CalendarView.css:411-420). Showcase WB:291-305 is 7 `ds-audit-item` boxes with a month label and none of those classes. Action: rebuild with real classes (one net per day, week-number column, side panel at left).
- **W-09 SYNC, three copied stylesheets lag the app.**
  - CSS-04 (calendarview) still has removed classes `.calendar-day-total-desktop`, `.calendar-spending-list`, `.calendar-currency`, `.calendar-bill-tag`, `.calendar-spending-row`, `.calendar-spending-label/description/amount` (CSS-04:167-333, 417-422). They are absent from src/styles/CalendarView.css.
  - CSS-10 (periodsummary) has old `.period-side-section*` and `.period-mini*` (CSS-10:29-31, 71-80). The app now uses `.period-side-summary` and `.period-side-note` (PeriodSummary.css:9-10; PeriodSummary.tsx:63-66).
  - CSS-11 (plans) has the dead `.calendar-spending-row-planned.is-sure` (CSS-11:19).
  - `src/styles/DayPanel.css` has no copy at all (`grep day-panel assets/css` = 0).
  Action: refresh 04/10/11 from src and add `DayPanel.css` as a new numbered file.
- **W-10 SYNC, desktop header is missing real parts.** App: L:330-389. Showcase WB:406-430 lacks the brand `<a aria-label="MyFinance calendar">` (L:331-334), nav item icons `<item.Icon size=16>` (L:358), `aria-label="Main navigation"` (showcase "Preview navigation", WB:414), the `.document-subtitle-mobile` class on calendar (L:338), the prev/next `.document-action` chevrons around `.document-period-label` (L:372-380, showcase WB:422-428 has none), and the three `.document-action.document-desktop-only` buttons: Add (`.document-add`), Refresh, Toggle theme (L:384-386). Action: add them (static) so the frame is a true "before" shot.
- **W-11 SYNC, bottom nav missing icons and Plus glyph.** App: L:408-446 puts a 20px lucide icon plus `<span>` per link (L:419-420) and `<Plus size=24>` inside `.document-bottom-add-circle` (L:437-439). Showcase WB:439-448 is text only and uses a literal `+`. aria-label is "Preview mobile bottom navigation" (L:408 is "Mobile bottom navigation"). Action: add SVG icons and the Plus.
- **W-25 SYNC, no preview of the mobile top bar.** At <=768px the header becomes a grid with `.document-mobile-period` (prev chevron, `.document-mobile-period-label` aria-live, next chevron; L:342-348; navigation.css:180-195) and hides `.document-brand-text`. The showcase `ds-mobile-doc-frame` (WB:434-449) shows only the bottom nav.
- **W-26 SYNC, document-level banners absent.** App: `.document-error` role=alert with Retry (L:392-397) and `.expense-notice` status with Undo/Dismiss (L:398-406). See also ADD A-3.
- **W-27 SYNC, shell frame text is fixture trivia.** WB:437 "Active categories: 7 ..." is not part of the app's `.document-content`. Action: replace with an empty `.document-content` placeholder.

### Modals

- **W-28 SYNC, QuickEntryDialog (Add/Edit).** The demo (JS:221-226) renders a single input in `.m-alert`. App: `.qe-layer > .qe-dialog` (QuickEntryDialog.tsx:84-86) with `.qe-d-head` (h2 "Add transaction"/"Edit expense", ModeToggle, close `.qe-fx`), two columns `.qe-d-left` (AmountDisplay, Keypad, `.qe-kbd` hint) and `.qe-d-right` (Category grid, Note, Date/Time, Repeat), and `.qe-d-foot` (Cancel, Delete, "+ Add & next", save). Action: render the real structure.
- **W-29 SYNC, MonthlyIncomeModal.** The demo is a text-only `.m-alert` (JS:227-228). App: `<dialog.monthly-income-modal>` titled "Income for {Month yyyy}" with `.monthly-income-modal-close` (aria-label "Close income dialog") hosting `IncomeSources` in add mode (MonthlyIncomeModal.tsx:62-86). Showcase title "MonthlyIncomeModal (2026-11)" is a dev name, not UI text.
- **W-30 SYNC, IncomeRecordSheet.** The demo has no fields (JS:229-230). App: vertical SystemAlert titled by the record, `.income-sheet-source` category, `.income-sheet-fields` (Amount, "Received on" date, Note) and buttons Save / "Delete payment" (destructive) / Cancel (IncomeRecordSheet.tsx:63-88). Showcase `[Cancel][Confirm]` footer (WB:462-465) is generic. Action: per-modal action sets.

### Feature tabs

- **W-12 SYNC, QuickEntryDock.** App QuickEntryDock.tsx:26-50: `<section.qe-dock aria-label="Quick entry">`, `.qe-dock-h` (ModeToggle small `role=radiogroup aria-label="Transaction type"` with `role=radio aria-checked`, `.qe-dock-to`, hide-keypad `.qe-fx`), `.qe-amount`, `.qe-chips` radiogroup, `.qe-dchips`, `.qe-keys` (named grid areas, `.qe-key-ok`, `.qe-key-next` "+ Next"). Showcase WB:71-100: `aria-pressed` mode toggle, `.qe-chip` spans, grid of `.qe-btn.is-plain` (the dialog footer button class), buttons "+ Queue" and "Save expense". App labels are "Add"/"Save N"/"Add plan" (QuickEntryParts.tsx:82-86). Action: use the real structure and labels.
- **W-13 SYNC, AuthScreen.** App AuthScreen.tsx:159-224: `.auth-card > header.auth-brand` (logo, `.auth-app-name`, `h1` "Sign in"), `<form.auth-form>`, `.auth-eye`, caps/meter, `.auth-switch`, `.auth-aurora` (L:37). Showcase WB:107-125 adds a subtitle and a "Sign in to MyFinance" button (app: "Sign in"), has no `.auth-aurora`, no password toggle, no switch link. Action: mirror the JSX and label.
- **W-14 SYNC, UserProfile.** App tab labels are Account, Income, Categories, Paycycle, "AI & MCP", Preferences (UserProfile.tsx:27-34). Showcase pills (WB:155-160) read "Pay cycle" and "Theme", and say "6 Navigation Sections". The real surface has `header.profile-identity` (avatar edit, `dl.profile-stats`; UserProfile.tsx:260-279), `nav.profile-rail` with icons, counts, unsaved dots and a sign-out button (L:281-305), and the mobile list `profile-m-home` grouped Account / Money / App (L:221-253). The "1-Tap Export CSV/JSON" card (WB:143-151, `ui-btn`) has no counterpart in src (no export-data UI found in src/components). Action: render rail + identity header; label the export card "proposal" or remove it.
- **W-15 SYNC, CategoryManager.** App CategoryManager.tsx:333-436: `.cat-manager` with `.cat-add`, `.cat-toolbar` (search, Sort segmented), `.cat-head` rows (checkbox, "30 days", Spent), `.cat-row` with look button, name + Bill pill, count, spend, actions menu, bulk bar and footer. Showcase WB:171-181 is a 3-col grid of `ds-audit-item` plus "+ New Category". Action: use `.cat-row` markup. Header text "CategoryManager (7 Active ...)" should be "Categories" + count pill (UserProfile.tsx:379-382).
- **W-16 SYNC, IncomeSources.** App heading "Income sources" with summary `dl` (One-time, ...) and a `profile-list` plus the add/edit form (IncomeSources.tsx:197-223). Showcase WB:190-194 uses audit boxes and "IncomeSources · Monthly Schedule". The weekend text differs ("Paid on Friday when the payday is a weekend", IncomeSources.tsx:294, vs showcase "Shift weekend payday: ON").
- **W-17 SYNC, BudgetPeriodSection.** App is a `<form.profile-card.budget-period>` titled "How are you paid?", radio cards "Calendar month" / "Monthly on a fixed day" / "Every paycheck of an income", the Payday field, then a "Show by" fieldset (Calendar month / Pay cycle) and a region suggestion (BudgetPeriodSection.tsx:21-29, 77-142). Showcase WB:204-208 labels "Calendar Month / Monthly from Day 5 / Paycheck Cycle" (internal ids shown as UI) and has no Show by group.
- **W-18 SYNC, AI & MCP tab (MCP half).** App McpAccessSection.tsx:129-342: `h2` "AI & MCP Server", endpoint row, "MCP 2025-03-26" pill, "Read & Write" pill, "Create token" button, create form, one-time secret card, `profile-list` with "Read only"/"Read & Write" pills and Revoke/confirm. Showcase WB:227-230 uses "Create Token", raw `scope: write` and `mf_pat_...` strings in audit boxes. The AiImportSection half (WB:216-224) is deferred (D-2).
- **W-19 SYNC, PlannedSpendings.** App: `section.profile-panel` "Spending plans", "Add plan" button, `dl.profile-summary` totals, `ul.profile-list` rows with a `profile-pill` "Sure" and icon edit/delete buttons (PlannedSpendings.tsx:225-243, 391-423). Estimates carry no pill (dashed, `~`). Showcase WB:240-249 is a `ds-table` with `plan-pill` Sure/Estimate and day-of-month "Due" values. `.plan-pill` is defined in Plans.css:14-15 but never used in src TSX (dead CSS in the app). Action: use `profile-list`; drop or reuse `plan-pill`.
- **W-20 SYNC, PlansPage.** App PlansPage.tsx:97-137: `section.profile-panel` "Plans · {range}", `.plans-page-tools` prev/next `profile-icon-button`, `PeriodRunway` (`.runway`, `.runway-hero`, `.runway-bar`), `ul.plans-payments`, `.plans-explain` (Sure / Estimate / Profile link), then PlannedSpendings. Showcase WB:258-266 is a "runway" div of 4 audit boxes.
- **W-21 SYNC, WeekView.** App WeekView.tsx:76-230: `.week-container`, `.week-mobile-summary`, `.week-feed-card.glass` with `.week-feed-day-col` and `.week-feed-tx-col`, rows `.week-feed-tx-row` (+ `.is-income/.is-planned`), `.week-feed-tx-badge`. Showcase WB:314-336 is `ds-audit-item` rows. It invents "Household Book", "Split: Minh 58% · Linh 42%", "Paid by", "Wallet Transfer · Not counted" and "Gold / Savings Pot" (`.ds-payer-pill`, `.ds-transfer-badge` exist only in CSS-16:477-495). No such concept exists in src (`grep -i "paid by|household"` returns nothing). Action: rebuild with the real feed card; label the household bits as a concept or remove.
- **W-22 SYNC, DayDetails.** App DayDetails.tsx:201-530: `.day-details` > header with back button "Back to calendar", `h2.day-details-date-title`, `.day-summary-card` (Total Spent / Received / Still planned), "Transactions" `.day-tx-card` rows, and "Planned" section with per-row `.day-planned-btn` = Done (aria "Record ... as spent now"), Change, Usual (only when overridden), Skip, Series. Showcase WB:343-349 shows 4 loose buttons without rows and "Usual" always. Action: add summary card and rows.
- **W-23 SYNC, AnalyticsView.** App AnalyticsView.tsx:203-290: `.an-hero` (month title, "Spent of income" progress), `.an-grid` of `.kpi.glass.span-3` with labels "Total spent", "Daily average", "Projected month-end"/"Month total". Showcase WB:358-360 uses "Total Spent (Cycle)", "Projected Cycle Total" and reads "6 charts" in the copy (charts not rendered).
- **W-24 SYNC, mobile month / week / analytics are 1-line text stubs.** App: MobileMonth.tsx:105-178 (`.m-nav`, `.m-mhead`, `.m-fbars`, `.m-mgrid` with `.m-dc` day cells, Plans `.m-row`), MobileWeek.tsx:230-370 (`.m-wbars`, `.m-strip` tablist, `.m-ledger`, `.m-swipe` rows), MobileAnalytics.tsx:81-140 (`.m-seg`, `.m-kpis`, `.m-bars`). Showcase WB:366-397 has a heading and a sentence each. Tab label "Week 47" chip is invented.
- **W-31 SYNC, calendar copy.** "Pay Cycle Day 5-4" and "Selected: 2026-11-18" (WB:293) are not the app's subtitle format (`periodTitle` e.g. "5 Oct – 4 Nov 2026", L:318-319).

## ADD (in app, missing from workbench)

- **A-1 ADD, DayPanel (desktop calendar day panel).** DayPanel.tsx:33-98 and src/styles/DayPanel.css:1-39. Structure to capture: `section.day-panel[aria-label="Day Wed, 18 Nov"]` > `.day-panel-head` > `.day-panel-top` (`.day-panel-main`: `.day-panel-count` + `.day-panel-over`, `.day-panel-net.is-in|over|plan|zero` with `.day-panel-currency`; `button.day-panel-add` 34px primary circle, aria "Add transaction for ...") + `.day-panel-tiles[role=group aria-label="Show only"]` of toggle `.day-panel-tile.is-in|over|plan` (`aria-pressed`, `-amount`, `-count`) > `.day-panel-list` rows `.day-panel-row(.is-button)` with `.day-panel-label` (wraps) + `.day-panel-amount.is-in|plan|is-expected`, empty `p.day-panel-empty` "Nothing on this day". Mounted at CalendarView.tsx:843-851 inside `.calendar-summary-side`. States to show: neutral/over-budget net, filtered tile, empty, expected income row.
- **A-2 ADD, CURRENT navbar (record for before/after).** Source L:325-389 + navigation.css.
  - `div.finance-document` (flex column, 100dvh) > `header.document-header.glass` (flex, space-between, wrap, padding 16px 24px, bottom radius `--radius-lg`; navigation.css:1-19). At <=768px: grid `auto 1fr auto`, padding 8px 12px (150-160).
  - **Brand:** `a.document-brand[aria-label="MyFinance calendar"]` > `.document-brand-icon` (40px img) + `.document-brand-text` (`.document-title` "MyFinance", `.document-subtitle` = period label; `.document-subtitle-mobile` on Calendar, hidden >=769px, navigation.css:405). Brand text hidden at <=768px.
  - **Mobile period:** `.document-mobile-period` (display none on desktop) = prev chevron, label (aria-live), next chevron (only for calendar/week/analytics).
  - **Primary nav:** `nav.document-nav[aria-label="Main navigation"]`: 5 `a.document-nav-link` (icon 16 + label), Calendar (LayoutGrid), Week (List), Plans (CalendarRange), Analytics (ChartColumn), Profile (User); active = `aria-current=page`.
  - **Actions:** `.document-actions` > (Calendar page only) `.document-period.document-desktop-only` = `.document-basis-toggle` Month | Pay cycle + prev + `.document-period-label` (`b` title, `span` day count) + next; otherwise prev/next `.document-action.document-desktop-only`. Then round 20px-icon buttons: Add expense `.document-add` (primary), Refresh records, Toggle theme (Sun/Moon). All `.document-desktop-only` (hidden <=768px).
  - **Bottom nav (<=768px only, display none otherwise):** `nav.document-bottom-nav.glass[aria-label="Mobile bottom navigation"]`: Month (CalendarDays), Week (List), `button.document-bottom-add` (`-circle` Plus 24 + `-label` "Add"; opens Week + keypad, L:219-224), Analytics, Profile. No Plans (see W-01).
  - **Sidebar:** the app has no global sidebar. The closest are `.calendar-summary-side` (absolute left column, `--calendar-side-width`, >=769px, Calendar page only: PeriodSidePanel + `.period-side-note` + DayPanel; CalendarView.css:403-420) and `nav.profile-rail` on Profile (UserProfile.tsx:281). A showcase before/after for "sidebar" must capture these two.
- **A-3 ADD, shell states.** FinanceGate loading and error cards (`.auth-card.glass` "Loading your finances…", "Unable to load your finances" with Retry / Sign out / theme button; L:89-107); session restore `main.auth-screen[role=status]` (L:63-67); `.document-error`; `.expense-notice` with Undo.
- **A-4 ADD, Calendar companion pieces.** `PeriodStrip` (phones, collapsible details; PeriodSummary.tsx:109-130), `PeriodSidePanel`, `.calendar-pay-cycle-hint[role=note]` (CalendarView.tsx:670), income dot / over-budget day states (`calendar-day-income-dot.is-expected`, `calendar-day-net.is-in|out|over`).
- **A-5 ADD, Profile detail states.** Mobile detail view (`is-m-detail`, `.profile-m-back`, UserProfile.tsx:221, 255-259), avatar edit form (L:315-325), unsaved-dot and `profile-tab-count` states, Account sign-out card (L:346-371), Preferences theme segmented control (L:395-405).
- **A-6 ADD, CategoryManager states.** Look popover (`.cat-look`), actions menu, merge picker and confirm (`role=alertdialog`), bulk toolbar, archived view, error (CategoryManager.tsx:264-330, 402-436).
- **A-7 ADD, Plans/PlannedSpendings states.** Add/Edit plan `form.income-form` (Sure / Estimate radio "fixed amount and date" vs "roughly this much", end date, changes-start date; PlannedSpendings.tsx:245-390), past-period `readOnly` banner (PlansPage.tsx:128), loading/error (L:109-110), `?edit=&from=` deep link.
- **A-8 ADD, MCP states.** Create-token form, one-time secret card with config snippet, revoke confirm (McpAccessSection.tsx:184-277, 308-342), empty and loading.
- **A-9 ADD, Day and Week planned/expected states.** Expected payday row with "Schedule" button (DayDetails.tsx:412-432), changing-amount inline form (L:459-466), skipped list (L:505-515), WeekView expected payday row (WeekView.tsx:153-157), Analytics empty `.an-empty` (AnalyticsView.tsx:174-182), MobileAnalytics empty card (MobileAnalytics.tsx:104-106).
- **A-11 ADD, inventory row for DayPanel.** The 30-row inventory (WB:453) lists CalendarView and DayDetails but not `src/components/DayPanel.tsx`; add a row (group "Desktop Views", jump to a new `day-panel` tab) and bump the "30 / 30" title and badge counts.
- **A-10 ADD, QuickEntry extras.** Dialog Income mode (Source chips, "How often", start/end dates; QuickEntryDialog.tsx:117-128), RepeatPanel (frequency, days, ends, Sure/Estimate), queue tray `.qe-tray` and queue list, `.qe-panel` detail panels (Date/Time/Note), discard confirm (QuickEntryDialog.tsx:137-147).

## Deferred (import-ai work, intentionally absent from this branch)

- D-1: tab `import` (WB:57, 270-288) with `.import-page/.import-card/.import-pill` and `CSS-06-import` (src/styles/Import.css does not exist).
- D-2: AiImportSection (WB:216-224; model list "GPT-OSS 20B ...", daily budget "$0.11 / $0.50") and AiModelPicker (inventory row WB:453).
- D-3: Inventory rows for `AiImportSection.tsx`, `AiModelPicker.tsx`, `import/ImportParts.tsx`, `import/ImportFlow.tsx`.
- D-4: `src/components/design-system`, `/design-system` route, `src/lib/import` (none present; `15-designsystem.css` is showcase-only).
- D-5: Badge and sidebar copy "AI & MCP Sections" (WB:52) and `ImportFlow` tab names (WB:55) lose meaning until the import work lands; revisit then.
- D-6: Profile "AI & MCP" tab keeps only MCP in this branch (UserProfile.tsx:391-393 renders McpAccessSection only); the showcase should split once AI is merged.

## Suggested order of work

1. W-08/W-09/A-1 (calendar plus DayPanel, refresh 04/10/11 + add DayPanel.css). 2. A-2/W-10/W-11/W-25 (capture the current shell as the "before"). 3. W-01/W-02 (decide Plans on mobile and a single nav model before the redesign). 4. A11y: W-03/W-04/W-05/W-07. 5. Remaining SYNC stubs.
