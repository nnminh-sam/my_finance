# Audit: design-system/charts.html (Analytics SVG Chart Library)

Sources: `src/components/charts.tsx` (C), `src/components/AnalyticsView.tsx` (AV), `src/components/mobile/MobileAnalytics.tsx` (MA), `src/lib/analytics.ts`, `src/styles/globals.css` (G). Showcase = `charts.html` (S).
Note: S `assets/css/00-globals.css` chart rules are identical to G:339-406 (verified by diff), so class/CSS drift is zero; all drift is in the inline markup.

## Summary

| Tag | Count |
|---|---|
| FIX | 9 |
| SYNC | 8 |
| ADD | 9 |
| Charts checked | 9 of 9 exports (CumulativeChart, DailyBarChart, DonutChart, WeekdayChart, PunchCard, ParetoChart, TrendChart, ProgressRing, Sparkline) |
| Consistent items (no entry) | 31 (list at bottom) |

## Per-chart status

| # | Chart | Showcase entry | FIX | SYNC | ADD | Status |
|---|---|---|---|---|---|---|
| 1 | CumulativeChart | S:30-57 | F-01,F-02,F-03 | S-02 | A-01,A-02,A-05 | drifted |
| 2 | DailyBarChart | S:58-85 | F-01,F-02,F-03,F-05,F-06 | S-03 | A-01,A-02,A-04 | drifted |
| 3 | DonutChart | S:86 | F-01,F-02,F-07,F-08,F-09 | none (geometry matches) | A-02,A-03 | mostly ok |
| 4 | WeekdayChart | S:86-98 | F-01,F-02 | S-04 | A-01 | drifted |
| 5 | PunchCard | S:115 | F-09 | none | A-08 | ok |
| 6 | ParetoChart | S:115-129 | F-01,F-02,F-04 | S-06 | A-06 | drifted |
| 7 | TrendChart | S:99-111 | F-01,F-02 | S-05 | A-09 | drifted |
| 8 | ProgressRing | S:112 | F-01,F-02 | S-07 | A-06 | ok |
| 9 | Sparkline | S:112 | F-01,F-02 | S-07 | A-06 | ok |
| - | Page-level (counts, badge, order) | S:30,113-114 | - | S-01,S-08 | A-07 | wrong counts |

## FIX

- **F-01 [all 8 SVG charts, app]** No chart SVG has `role="img"` or an accessible name. Evidence: C:141, 247, 364, 428, 577, 638, 727, 761 (bare `<svg width height>`); donut centre text is a plain div (C:396). Action: add `role="img"` plus a computed `aria-label` (e.g. "Cumulative spend 12.3M of 32.5M income") to each SVG; hide decorative gridlines with `aria-hidden`.
- **F-02 [all charts, showcase]** Showcase SVGs have `aria-label` but no `role="img"` (S:30, 58, 86 weekday, 99, 116) and the donut, ring and both sparklines have no label at all (S:86 donut svg, S:112). Action: add `role="img"` everywhere; mirror whatever F-01 decides in the app.
- **F-03 [Cumulative/Daily/KPIs, app]** Currency and number formatting differs by surface. Axis/labels use `fmtCompact` with no unit (C:160, 82 via analytics.ts:74-81), tooltips use `fmtVND` "1.234.567 ₫" (C:195, 329), AV KPI shows `fmtCompact(a.total)` without ₫ (AV:235) while MA appends " ₫" to compact values (MA:113-115). Showcase follows the unit-less style and never shows a ₫ or vi-VN example (S:38-42, 84, 86). Action: pick one rule (compact = unit-less on axes, " ₫" on stand-alone figures, full `fmtVND` in tooltips) and apply it in AV/MA; document it on the page.
- **F-04 [ParetoChart, showcase]** Marker contradicts its label: label says "80% spend in 28% days" (S:121) but the dot is at cx=326 of 452 (72%) (S:124); at 28% it should be about x=127. Action: move the dot/guide lines to x=127 or change the label.
- **F-05 [DailyBarChart, showcase]** Anomaly "!" is drawn without the red `r=7` badge circle (S:69, 76), but `.chart-anomaly-text` is `fill:#fff` (G:359), so the mark is white on the card and effectively invisible. App draws circle then text (C:303-308). Action: add `<circle r="7" fill var(--danger)>` behind each "!" and the glow filter.
- **F-06 [DailyBarChart, showcase]** Axis ticks 1, 6, 12, 18 (S:80-83) do not follow `dayTicks` (1,5,10,15,20,25,n; C:90) and label day 18 over a chart that draws 13 bars (S:65-78). Action: draw a full month (28-31 bars) with ticks 1/5/10/15/20/25/n.
- **F-07 [DonutChart, showcase]** Pill claims "Capped at 5 series + Other (Dash.fi rule)" (S:86) but the app maps every category to a segment with no cap and no "Other" bucket (AV:190, C:367). The page documents a rule the app does not implement. Action: remove the pill or implement the cap in AV (product decision).
- **F-08 [DonutChart, app+showcase]** Segment colours are raw hex: app fallback palette `FALLBACK_COLORS` (AV:49) and showcase `stroke="#eab308"` etc. (S:86). Category colours from settings are user data, but the fallback and showcase should use tokens (or a documented category-palette) so dark/light themes stay legible. Action: promote fallback palette to CSS tokens and reference them in the showcase.
- **F-09 [Donut/Cumulative/Daily/Weekday/Trend/PunchCard, app]** Interaction is mouse-only (`onMouseEnter/Move/Leave`: C:128, 319, 387, 444, 512, 654); no focus, keyboard or touch alternative. MA already does this right with buttons and aria-labels (MA:182, 203). Action: add focusable hit targets or a data-table fallback; show the focus/selected state in the showcase.

## SYNC

- **S-01 [page header]** "All 9 ... powered by `ResizeObserver`" (S:30) is wrong: only 5 charts use `useContainerWidth` (C:12; Cumulative 102, Daily 218, Weekday 410, Pareto 563, Trend 621); Donut, PunchCard, ProgressRing, Sparkline do not. Badge "6 calm core charts · 2 collapsed statistical" (S:30) sums to 8 and the page renders 7 core + 2 collapsed = 9. Action: rewrite to "9 charts (5 responsive via ResizeObserver)" and "7 core · 2 statistical".
- **S-02 [CumulativeChart]** Forecast line/band use `var(--forecast)` (S:45, 48) but app uses `var(--accent)` (C:166, 170). Also: band opacity 0.18 vs 0.14; forecast dash `5 4` vs `6 5` (C:170); line width 2.5 inline vs `.chart-line` 3 (C:168, G:346); end dot r=4.5 with card-coloured stroke (S:49) vs r=5 `chart-pulse` no stroke (C:177); gradient stop 0.42 vs 0.45 (S:33, C:144); canvas 520x240 / translate(48,16) vs height 280 / margin left 52, right 16, bottom 28 (C:105-106). Action: change token to `--accent` and align constants; drop `--forecast` from this chart.
- **S-03 [DailyBarChart]** Bars use fixed opacity 0.75 (S:65-78) vs volume-scaled `0.3 + 0.6*total/max` (C:240); anomaly bars at 1.0 vs 0.9 plus glow filter (C:249, 284); mean label "Mean 1.0M" inside the plot (S:84) vs "Avg" above the line (C:292-294); MA stroke 2.2 vs 2.5 (S:79, C:298); rx 3 vs `min(bw/2,4)`; height 240 vs 260. Action: align opacity formula, label text, stroke and height.
- **S-04 [WeekdayChart]** Showcase draws a y-axis with grid and "0/2M/4M" (S:88-90) and flat `opacity:.65` fills (S:91-97). App has no y-axis (margins left/right 8, C:414), uses gradient fills `--primary` to 0.25 and `--accent` for peak (C:430-437), shows a value label over peak/hovered bar (C:456-460) and an average ref line (C:473). Peak label is `--text-main` bold (C:466) vs `--accent` (S:96). Action: remove axis, add gradients, value label, avg line, fix label colour.
- **S-05 [TrendChart]** Same pattern: showcase has y-axis grid (S:101-103), app has none (C:625). App prior-month bars use a `--text-muted` gradient (C:641-644), current bar `--primary` to `--accent` gradient (C:645-648); showcase uses primary 0.65 and flat accent (S:104-110). Ghost bar is `.chart-ghost-bar` (stroke `--accent`, C:663, G:355) vs `--forecast` fill+stroke (S:109). Missing: prior-average `--warning` ref line (C:699-702), value label above current bar (C:676-686). Height 220 vs 200. Action: rebuild from C geometry.
- **S-06 [ParetoChart]** Showcase: height 220, left margin 48 (S:116) vs 200 / 36 (C:565-566); curve `--primary` (S:123) vs `--accent` (C:598); 80% marker is one full-width accent line + custom label "80% spend in 28% days" (S:120-121) vs two `--warning` guide lines, pulse dot and "28% → 80%" label (C:599-607); x labels "0% days" (S:125-127) vs `fmtPct` "0%/50%/100%" (C:591-593); missing gradient area (C:596) and grey diagonal (S:122 uses `--border-color` + custom dash vs `.chart-ref-line` muted, C:597). Action: copy C structure.
- **S-07 [ProgressRing, Sparkline]** Ring geometry matches (r 34.5, C 216.77, offsets 68%/92% verified). Centre text is 0.85rem uncoloured (S:112) vs 0.95rem/800 in `savingsColor` (AV:296). Sparkline default is 96x32 (C:751-752, used default at AV:265, colour `--primary`); showcase uses 150x42 with accent/success. Action: show the default size and the `--primary` usage; keep other sizes labelled as prop variants.
- **S-08 [page structure]** Showcase order 1,2,3,4,7,8/9 then collapsed 5,6 (S:30-130) and "Collapsed by default for Calm Analytics" (S:114). App renders all in one grid and in a different order: Cumulative, Donut, Daily, Weekday, PunchCard, Pareto, Trend (AV:324-650); MA shows only CumulativeChart (MA:127). Action: renumber to app order, drop the "calm/collapsed" claim or mark it as a showcase-only grouping.

## ADD

- **A-01 Tooltip/TooltipRow + crosshair/hover dot** (C:41-70, 184-186; G:357-376): no showcase entry. Add a static tooltip specimen incl. dashed swatch row.
- **A-02 Chart legends** (`LegendItem` AV:90-95; `.legend*` G:330-336; `.donut-wrap`/`.donut-legend*` G:379-390; used AV:316-322, 336-358, 369-373): not shown. Add legend specimens.
- **A-03 DonutChart active state** (C:360, 378, 384, 399): hovered segment (width +8, others 0.3, centre label + `donut-center-sub` pct) not shown.
- **A-04 DailyBarChart future days** (`.chart-future-bar`, C:267-269; G:354): not shown; also hover dimming (C:281).
- **A-05 CumulativeChart variants** (no income line C:156; past month with no projection; hover crosshair C:182): only the full forecast case is shown.
- **A-06 Empty/degenerate states**: `.an-empty` card (AV:174-186; G:685), Sparkline returns null for <2 points (C:755), Pareto renders nothing for <=1 point (C:576), ProgressRing `--danger` / `--text-muted` "—" states (AV:193, 296). No loading state exists in the app (charts render nothing until `width>0`, C:140), so there is nothing to show beyond documenting that.
- **A-07 Mobile analytics family** (MA:142-211): `.m-bars/.m-bar`, `.m-heat` button grid, `.m-cols` daily columns, `.m-legend` are chart-like components with no showcase entry and are not exports of charts.tsx.
- **A-08 PunchCard hover/range** (hover outline + footer detail text C:520, 536-540; window widening beyond 6-23h C:491-496): not shown.
- **A-09 TrendChart partial vs complete month** (ghost projection + "x → y" label C:656-685 vs complete month): only partial shown, and without ghost-bar class (see S-05).

## Deferred (import-ai, not tagged)

- `charts.html:14` links `assets/css/06-import.css` (copy of `src/styles/Import.css`, absent from this branch); not chart-related, left as is.
- Nothing else on this page depends on `src/lib/import`, AiImportSection, AiModelPicker, ImportFlow, `src/components/design-system` or the `/design-system` route.

## Consistent items checked (31, no entry)

Chart export count 9 = nav badge/overview "9" (S:28, index); Donut r=91, C=571.77, gap 3, stroke 26, rotate -90, track `--bg-card-hover` (C:356-366); Donut centre label "Total spent" + `fmtCompact` total; Ring r/stroke/C/offset maths and tokens `--success`/`--warning`; Ring track token; Sparkline path/area maths and gradient; Sparkline stroke 2 round caps; PunchCard grid template `36px repeat(18)`; 6h-23h window; col labels every 3h; cell colour `color-mix(--primary 20+80*i%)`; legend 36/52/68/84/100; glow `--primary-glow` > 0.7; footer text; row labels Mon-Sun; Cumulative axis classes `chart-grid/axis-text`; income ref line `--success` and "Income 32.5M" label; income label `fmtCompact`; gradient tokens (`--primary`); end-dot colour; Daily danger fill for anomalies; Daily MA `--accent`; mean line `--text-muted`; Weekday rx 6 and Mon-Sun labels; Trend rx 6 and month labels; Trend current bar bold label; all chart colours via `var(--token)` except F-08; grid/axis/ref classes match G:339-346; `.chart-wrap` container; light/dark handled by tokens (no mode-specific literals in S).
