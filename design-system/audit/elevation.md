# Audit: elevation.html (Radii, Glass, Elevation, Z-Index & Motion)

Source of truth: `src/styles/*.css` (branch develop/feat/navbar-sidebar-redesign). Page: `design-system/elevation.html` (one 52-line file; the section is on line 30).
Method: read the page, grepped every radius/shadow/backdrop-filter/z-index/@keyframes/animation/transition/reduced-motion in src, diffed each `assets/css/NN-*.css` copy against its src file, grepped components for class usage.

## Summary

| Tag | Count |
|---|---|
| FIX | 9 |
| SYNC | 8 |
| ADD | 5 |
| Deferred (not counted) | 6 items |

Items checked: 44 = 5 radius rows, 1 glass card, 7 shadow rows, 10 z-index rows, 21 keyframe cards.
Consistent with src: 30 (radius 4, glass 1, shadow 4, z-index 9, keyframe 12). The rest are in findings below, or Deferred (import-spin).
No keyframe name is defined twice in src or in `assets/css/` (20 distinct names in src, 21 in the showcase copies). The z-index values have no collisions in the same stacking context.

## FIX

**E-01 Replay button is a no-op.** `assets/js/design-system.js:127` selects `.ds-keyframe-demo`, but `elevation.html:30` has no such class (0 matches; cards use `.ds-motion-pill`, an svg and `.auth-spinner`). Action: query `.ds-motion-pill, .ds-motion-stage svg path, .auth-spinner` or add `ds-keyframe-demo` to the demo elements.

**E-02 No prefers-reduced-motion in globals.css.** Animations at `globals.css:80,84,281,347-348,351,356(infinite),369,381,423,482,640` and `.animate-*` (69-86) have no guard. Only Alert:30, AuthScreen:189, Mobile:157, PeriodRunway:79, QuickEntry:177 have one. Action: add one reduce block that sets `animation: none` (and `opacity: 1` for the `opacity:0` + `forwards` entrances at 281, 423, 640).

**E-03 No reduced-motion for CalendarView and ExpenseForm.** `CalendarView.css:221` (calendarFillLeftToRight) and `ExpenseForm.css:553,569` (fadeIn/slideUp) have no guard. Transition-only gaps: `navigation.css:306`, `PeriodSummary.css:68`, `QuickEntry.css:83` (switch). Action: extend each file's media block (QuickEntry.css:177 is the model).

**E-04 The showcase page itself ignores reduced motion.** `elevation.html:30` runs infinite demos (auth-drift-1..3 18-22s, auth-spin, pulseRing) and `assets/css/15-designsystem.css` has no `prefers-reduced-motion` block. Action: add one to 15-designsystem.css for `.ds-motion-pill` and `.auth-spinner`.

**E-05 Dead and duplicate keyframes.** `m-pop` (`Mobile.css:121`) is never referenced (no `animation:` use in src/styles, no match in src/components or src/app), yet the page shows it as a live card. Bodies are identical across these groups:
- m-pop, m-alert-pop (Alert.css:10) and the entrance part of qe-pop
- m-shake (Mobile.css:103) and qe-shake (QuickEntry.css:41)
- m-pulse (Mobile.css:95) and qe-pulse (QuickEntry.css:110)
- fadeIn (globals.css:74), qe-fade (QuickEntry.css:126) and donutIn (globals.css:204)

Action: delete m-pop; consolidate the shake, pulse and fade pairs onto one name each.

**E-06 Hard-coded radii where a token exists.** About 36 declarations use a literal `8px`, `12px` or `16px` instead of `--radius-sm/md/lg` (globals.css:40-42). Examples:
- 16px: `Alert.css:9`, `AuthScreen.css:78`, `WeekView.css:153`
- 12px: `Mobile.css:117`, `AuthScreen.css:97,157`, `ExpenseForm.css:364,480,603`, `navigation.css:34`, `QuickEntry.css:95,117,138,149`
- 8px: `globals.css:644`, `navigation.css:331`, `ExpenseForm.css:258,692`

Only globals/UserProfile/navigation/ExpenseForm/CalendarView/PeriodSummary use the tokens; AuthScreen, Mobile, QuickEntry, PeriodRunway, Plans and DayPanel use none. Action: swap exact matches for the token.

**E-07 Dead rules in ExpenseForm.css that this page documents as live.** No component or app file references `expense-modal`, `expense-error-backdrop/-popup`, `expense-category-dropdown` or `expense-input-leading-icon`:
- `.expense-modal` and its backdrop (645-668)
- the error popup (542-570)
- the category dropdown (235-250, z-index 30)
- the leading icon (294-299, z-index 1)

Grep found no matches for these class names, so dynamic class names are the only way they could be used. `.expense-error` is also defined twice (528, 532). The page's z-index rows for 1, 30 (partly) and 100, the 24px radius and the ".45 modal shadow" all come from these rules. Action: delete the dead blocks, or confirm they are reachable. Then re-source the page rows from live classes.

**E-08 Missing `-webkit-backdrop-filter` pair.** `AuthScreen.css:51` (blur 8px) and `MonthlyIncomeModal.css:19` (blur 4px) set only the unprefixed property. All other surfaces (globals:90-91,365; ExpenseForm:551-552,663-664; navigation:235-236; Auth:66-67) set both. Action: add the prefixed line.

**E-09 Broken/unscoped markup on the page.**
- The `.profile-button` at `elevation.html:30` is styled only by `.user-profile .profile-button` (`UserProfile.css:122`), so outside that wrapper it relies on inline style. Wrap it in `.user-profile` or use a `.ds-*` button.
- Naming drift: `<title>` and sidebar say "Radii, Glass & Motion", the h2 says "Radii, Glass, Elevation, Z-Index & Motion" (lines 6, 28, 30). Action: pick one name.

## SYNC

**E-10 "Subtle Active Pill" shadow value.** The page shows `0 1px 2px rgba(0,0,0,0.25)` (`elevation.html:30`). No src rule has 0.25. Real values: `navigation.css:401` `rgb(0 0 0 / 15%)`, `UserProfile.css:275` `color-mix(--text-main 15%)`, `CalendarView.css:373` `rgb(0 0 0 / 12%)`. Action: show 15% and note the 12% variant.

**E-11 "Dropdown / Chart Tooltip" merges two different shadows.** The page shows `0 14px 36px rgba(0,0,0,.45)` and cites `globals.css:366`. The chart tooltip is `0 12px 32px -8px rgba(0,0,0,.45)` at `globals.css:367`. The 14/36 value is `ExpenseForm.css:248` (dead rule, see E-07). The Import.css half is Deferred. Action: split into Chart Tooltip (globals.css:367) and a live dropdown; fix the cite.

**E-12 "Floating Modal / Dialog" shadow and sources.** The page shows `0 24px 64px rgba(0,0,0,.45)`, cited to QuickEntry.css and MonthlyIncomeModal.css. Actual: `QuickEntry.css:127` `0 24px 60px rgba(0,0,0,.3)`, `MonthlyIncomeModal.css:14` `0 24px 64px rgba(0,0,0,.3)`. The .45 value exists only in dead `ExpenseForm.css:658`. Action: use `0 24px 64px .3` (income modal) and list QE separately.

**E-13 "7 shadow tiers" has no basis in src.** There are no `--shadow-*` tokens; src has about 25 distinct hard-coded shadow values. Action: rename to "7 representative recipes", or introduce tokens first (then update E-11, E-12 and ADD E-19).

**E-14 Keyframe timing/easing drift.** The page text and inline demos disagree with src:
- m-pulse: page `0.6s ease`; `Mobile.css:94` `.6s ease-out`
- m-shake: page `0.35s ease`; `Mobile.css:102` `.12s linear 3`
- auth-rise: page `0.2s ease-out`; `AuthScreen.css:146` `0.2s ease`
- pulseRing: page `2s infinite`; `globals.css:356` `2s ease-in-out infinite`
- calendarFillLeftToRight: page `0.26s / 0.28s`; `CalendarView.css:221` only `0.28s` (the 0.26s `.calendar-spending-row` rule exists only in the stale showcase copy)

Action: correct the labels and the inline `animation:` values.

**E-15 Variants missing from slideUp/fadeIn labels.** The page says slideUp `0.3s / 0.5s` and fadeIn `0.2s / 0.9s`. src also has slideUp 0.25s (`globals.css:482`), 0.4s (:423), 0.45s (:640), 0.2s (`ExpenseForm.css:569`) and fadeIn 0.12s (`globals.css:369`), 0.15s (`ExpenseForm.css:553`), and 0.9s carries a `0.5s` delay (:348). Action: list all or say "0.12-0.9s".

**E-16 Stale line citations on the page.** Each cite below is from `elevation.html:30`:
- m-alert-pop `Alert.css:20`: keyframe is :10, use :9
- calendarFillLeftToRight `CalendarView.css:536`: keyframe :206, use :221
- z-index 2 row `CalendarView.css:523`: today cell :154, summary-side :422
- literal radii `ExpenseForm.css:647`: modal radius is :655
- chart tooltip `globals.css:366`: :367
- Rows citing only a file name (donutIn, auth-rise, m-pulse, m-shake, "globals.css" glow) have no line.

Action: refresh the cites.

**E-17 Showcase stylesheet copies are stale.** `04-calendarview.css`, `10-periodsummary.css` and `11-plans.css` differ from src; the other 12 copies match apart from the header line. Impact on this page: in src the summary panel is on the **left** at `min-width:769px` with `z-index:2` (`CalendarView.css:411-424`), while the copy keeps a right-hand panel at 1280px (`04-calendarview.css:509-526`) and extra `calendarFillLeftToRight` users. `DayPanel.css` has no copy in assets. Action: re-copy from src.

## ADD

**E-18 Shadows missing from the page (src):**
- `Alert.css:9` `0 20px 50px rgba(0,0,0,.35)` (the m-alert)
- `globals.css:287` `.kpi/.an-card:hover` `0 10px 40px -12px var(--primary-glow)`
- `navigation.css:305,312,393` FAB glow plus `0 0 0 4px var(--bg-main)` ring
- `AuthScreen.css:80,162` logo ring and submit
- Focus rings `0 0 0 3-4px`: `AuthScreen.css:101,133`, `QuickEntry.css:18`, `UserProfile.css:343`
- Segmented-control thumb `0 1px 3px rgba(0,0,0,.15)`: `Mobile.css:126`, `QuickEntry.css:30`
- Inset selection rings: `CalendarView.css:445,397`, `PeriodRunway.css:38,42`, `Mobile.css:187`

**E-19 z-index layer missing.** `.calendar-day-cell.glass.is-selected` has `z-index:1` (`CalendarView.css:445`, desktop only). Add it to the z=1 row. Also state that `.expense-modal` is not a live top-layer dialog (see E-07); the real top-layer users are `SystemAlert.tsx:47` and `MonthlyIncomeModal.tsx:64`.

**E-20 Glass/backdrop surfaces missing.** The page shows only `.glass` (blur 12px, `globals.css:88-93`). Also in src:
- `.chart-tooltip` blur(10px): `globals.css:365`
- bottom nav blur(14px): `navigation.css:235`
- `.auth-card` blur(24px): `AuthScreen.css:66`
- `.auth-theme-toggle` blur(8px): `AuthScreen.css:51`
- `::backdrop` blur(4px): `MonthlyIncomeModal.css:19`
- `.glass` opt-outs `backdrop-filter:none`: `CalendarView.css:135,440` (desktop table cells, outside days)

The `--glass-bg` and `--glass-border` values for both themes (`globals.css:11-12,102-103`) are not shown.

**E-21 Radius literals missing.** The "Literal radii" row omits 2px, 3px, 4px and 6px (`globals.css:251,333,398`), the `20px 20px 0 0` sheet (`QuickEntry.css:163`), `var(--radius-md) var(--radius-md) 0 0` (`navigation.css:233`) and `4px 4px 2px 2px` (`Mobile.css:59`). New `DayPanel.css` adds 10px and 999px, which are already in the list.

**E-22 No timing reference.** The page is titled "Motion" but shows no easing/duration summary. src has no tokens; `cubic-bezier(0.16, 1, 0.3, 1)` is repeated in 10+ places (`globals.css:80,248,281,351,423,445,482,627,640,658,681`, `CalendarView.css:221`, `ExpenseForm.css:569`), and `0.15s ease` is the usual hover transition. Add a small table, and consider `--ease-out` / `--dur-*` tokens.

## Deferred (import-ai work, not tagged)
- `import-spin` card (`elevation.html:30`; keyframe in `assets/css/06-import.css:155`) and its `.import-page` wrapper markup.
- z-index rows citing `.import-grid th` (z1), `.import-foot` (z2) and `.ai-menu` (z20, `Import.css:259`).
- The "Import.css" part of the Dropdown shadow cite (E-11).
- `06-import.css` copy itself.
- Counts "21 keyframes / 7 files" (h2, badge, card head, `21 kf` in the sidebar of every page and in index/swarm-report/v2-fixes): on this branch src has 20 keyframes in 6 files; recheck once import-ai lands.
- Any `src/components/design-system` and `/design-system` route material.
