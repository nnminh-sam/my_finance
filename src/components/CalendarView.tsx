'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlanOccurrence } from "../lib/plans";
import {
  format,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isToday,
  subMonths,
  addMonths,
  addWeeks,
  subWeeks,
  parseISO,
} from "date-fns";
import { getTotalForDate, getTopSpendingsForDate, formatCompactSpending } from "../lib/spendings";
import {
  FETCH_WEEKS_STEP,
  PRELOAD_MONTHS,
  buildPeriodPages,
  createInitialMonthRange,
  expandMonthRange,
  formatWeekOfYear,
  getNextWeeksToFetch,
  getWeekKeysInRange,
  getWeekOfYear,
} from "../lib/calendarWindow";
import type { FetchedWeekBounds, MonthRange, ScrollDirection, WeekRenderStage } from "../lib/calendarWindow";
import { useFinance } from "../contexts/FinanceContext";
import { useFinanceShell } from "../contexts/FinanceShellContext";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useSettings } from "../contexts/SettingsContext";
import { getHeatmapColor } from "../lib/heatmap";
import Link from "next/link";
import { getRangeIncome } from "../lib/income";
import { dismissPayCycleHint, shouldShowPayCycleHint } from "../lib/legacyPayday";
import { DEFAULT_BUDGET_PERIOD, periodOf, periodRangeLabel, periodsBetween, type BudgetPeriod, type BudgetPeriodSetting } from "../lib/periods";
import { addDays } from "../lib/plans";
import { useAuth } from "../contexts/AuthContext";
import { PeriodSidePanel, PeriodStrip, type MiniCalendarSpec } from "./PeriodSummary";
import "../styles/CalendarView.css";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const CALENDAR_MONTHS: BudgetPeriodSetting = { mode: "calendar", startDay: 1, paycheckIncomeId: null };
const todayString = () => format(new Date(), "yyyy-MM-dd");
const overlapDays = (a: Pick<BudgetPeriod, "start" | "end">, b: Pick<BudgetPeriod, "start" | "end">) => {
  const start = a.start > b.start ? a.start : b.start, end = a.end < b.end ? a.end : b.end;
  return end < start ? 0 : Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
};
/** Of `candidates`, the period sharing the most days with `page` (the first one on a tie). */
const mostOverlapping = (candidates: BudgetPeriod[], page: Pick<BudgetPeriod, "start" | "end">) =>
  candidates.reduce((best, next) => (overlapDays(next, page) > overlapDays(best, page) ? next : best));
/** The day a page stands for: today on the current page, otherwise the page's first day. */
const pageAnchor = (page: Pick<BudgetPeriod, "start" | "end">, today: string) =>
  today >= page.start && today <= page.end ? today : page.start;

interface CalendarViewProps {
  currentDate: Date;
  onActiveMonthChange?: (date: Date) => void;
  onDateClick: (date: Date) => void;
  onEditIncome?: (month?: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  currentDate,
  onActiveMonthChange,
  onDateClick,
}) => {
  const { settings } = useSettings();
  const { spendings, incomes, hasLoaded, fetchWeeksSpendings, projectedBetween } = useFinance();
  const { activeDate: shellActiveDate, calendarBasis: basis } = useFinanceShell();
  const { user } = useAuth();
  const budgetPeriod = settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD;
  // Pages and totals follow the calendar month or the budget period, as picked in the top bar.
  // Each page is one whole period, so a pay cycle is never split across two pages. Keyed by value, so a
  // settings object recreated with the same content does not rebuild the pages.
  const pageSettingKey = JSON.stringify(basis === "cycle" ? budgetPeriod : CALENDAR_MONTHS);
  const pageSetting = useMemo<BudgetPeriodSetting>(() => JSON.parse(pageSettingKey), [pageSettingKey]);
  const resolvePage = useCallback((date: string) => periodOf(pageSetting, incomes, date), [pageSetting, incomes]);
  const resolvePageRef = useRef(resolvePage);
  resolvePageRef.current = resolvePage;
  const [hintDismissed, setHintDismissed] = useState(false);
  // The hint only exists for a device that still holds the old pay cycle and an account on defaults.
  const showPayCycleHint = hasLoaded && !hintDismissed && typeof window !== "undefined"
    && shouldShowPayCycleHint(settings, user?.id, window.localStorage);
  const dismissHint = () => {
    dismissPayCycleHint(window.localStorage, user?.id);
    setHintDismissed(true);
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const ignoreMonthSyncUntilRef = useRef<number>(0);
  const hasInitialScrolledRef = useRef(false);
  const lastScrollLeftRef = useRef(0);
  const lastExternalDateRef = useRef<string>(format(currentDate, 'yyyy-MM-dd'));
  // A page to bring into view after the next render, once any earlier pages have been added on the left
  // (scrolling before that would be undone by the prepend anchor below).
  const pendingScrollRef = useRef<{ key: string; behavior: ScrollBehavior } | null>(null);
  const [, setScrollTick] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const prependAnchorRef = useRef<{
    pageKey: string;
    relativeLeft: number;
  } | null>(null);

  const [activePageKey, setActivePageKey] = useState<string>(() => resolvePage(format(currentDate, 'yyyy-MM-dd')).start);

  // Preload 2 months before and 2 months after the initial month, expanding dynamically on side scroll
  const [monthRange, setMonthRange] = useState<MonthRange>(() =>
    createInitialMonthRange(currentDate, PRELOAD_MONTHS),
  );

  // Track progressive rendering stage per individual day ('dates' -> 'totals' -> 'details')
  const [dayStages, setDayStages] = useState<Record<string, WeekRenderStage>>({});
  const fetchedWeeksRef = useRef<Set<string>>(new Set());
  const visibleWeekKeysRef = useRef<string[]>([]);
  const queuedDaysRef = useRef<Set<string>>(new Set());
  const revealQueueRef = useRef<string[]>([]);
  const revealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detailTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Track which week boundaries have been fetched
  const fetchedBoundsRef = useRef<FetchedWeekBounds>((() => {
    const initial = resolvePage(format(currentDate, 'yyyy-MM-dd'));
    return {
      startWeek: startOfWeek(parseISO(initial.start), { weekStartsOn: 1 }),
      endWeek: startOfWeek(parseISO(initial.end), { weekStartsOn: 1 }),
    };
  })());

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (revealIntervalRef.current) {
        clearInterval(revealIntervalRef.current);
        revealIntervalRef.current = null;
      }
      for (const timer of detailTimersRef.current) {
        clearTimeout(timer);
      }
      detailTimersRef.current.clear();
    };
  }, []);

  /**
   * Sequentially fills in visible fetched days one by one:
   * - Ordered from Left to Right (Mon -> Sun) and Top to Bottom (Week 1 -> Week 5)
   * - Each day transitions: 'dates' (already rendered) -> 'totals' -> 'details'
   */
  const startDayRevealLoop = useCallback(() => {
    if (revealIntervalRef.current) return;

    revealIntervalRef.current = setInterval(() => {
      const nextDayKey = revealQueueRef.current.shift();
      if (!nextDayKey) {
        if (revealIntervalRef.current) {
          clearInterval(revealIntervalRef.current);
          revealIntervalRef.current = null;
        }
        return;
      }

      // Stage 2: Silently reveal total spending + heatmap for this day
      setDayStages((prev) => {
        if (prev[nextDayKey] === 'totals' || prev[nextDayKey] === 'details') return prev;
        return { ...prev, [nextDayKey]: 'totals' };
      });

      // Stage 3: Silently reveal detailed spendings for this day shortly after its total
      const detailTimer = setTimeout(() => {
        detailTimersRef.current.delete(detailTimer);
        setDayStages((prev) => {
          if (prev[nextDayKey] === 'details') return prev;
          return { ...prev, [nextDayKey]: 'details' };
        });
      }, 85);
      detailTimersRef.current.add(detailTimer);
    }, 24);
  }, []);

  const enqueueVisibleFetchedDays = useCallback(() => {
    const visibleWeeks = visibleWeekKeysRef.current;
    if (visibleWeeks.length === 0) return;

    const visibleDaySet = new Set<string>();
    const orderedVisibleDays: string[] = [];

    // Build ordered list: Top-to-Bottom (week by week), Left-to-Right (Mon -> Sun)
    for (const weekKey of visibleWeeks) {
      if (!fetchedWeeksRef.current.has(weekKey)) continue;
      const weekMonday = parseISO(weekKey);
      const weekSunday = endOfWeek(weekMonday, { weekStartsOn: 1 });
      const daysInWeek = eachDayOfInterval({ start: weekMonday, end: weekSunday });
      for (const d of daysInWeek) {
        const dayKey = format(d, 'yyyy-MM-dd');
        visibleDaySet.add(dayKey);
        orderedVisibleDays.push(dayKey);
      }
    }

    // Keep only still-visible days in the pending queue so current viewport always fills in first
    revealQueueRef.current = revealQueueRef.current.filter((dKey) => {
      if (visibleDaySet.has(dKey)) return true;
      queuedDaysRef.current.delete(dKey);
      return false;
    });

    for (const dayKey of orderedVisibleDays) {
      if (!queuedDaysRef.current.has(dayKey)) {
        queuedDaysRef.current.add(dayKey);
        revealQueueRef.current.push(dayKey);
      }
    }

    if (revealQueueRef.current.length > 0) {
      startDayRevealLoop();
    }
  }, [startDayRevealLoop]);

  const fetchWeekBatch = useCallback((startWeekMonday: Date, endWeekMonday: Date) => {
    const start = startOfWeek(startWeekMonday, { weekStartsOn: 1 });
    const end = startOfWeek(endWeekMonday, { weekStartsOn: 1 });
    if (start.getTime() > end.getTime()) return;

    const weekKeys = getWeekKeysInRange(start, end);
    const startDateStr = format(start, 'yyyy-MM-dd');
    const endDateStr = format(endOfWeek(end, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    void fetchWeeksSpendings(startDateStr, endDateStr)
      .catch(() => [])
      .finally(() => {
        for (const key of weekKeys) {
          fetchedWeeksRef.current.add(key);
        }
        enqueueVisibleFetchedDays();
      });
  }, [enqueueVisibleFetchedDays, fetchWeeksSpendings]);

  const capturePrependAnchor = useCallback((anchorPage?: HTMLElement | null) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const pageEl =
      anchorPage ||
      container.querySelector<HTMLElement>(`.calendar-month-page[data-page="${activePageKey}"]`) ||
      container.querySelector<HTMLElement>('.calendar-month-page');
    if (pageEl && pageEl.dataset.page) {
      prependAnchorRef.current = {
        pageKey: pageEl.dataset.page,
        relativeLeft: pageEl.offsetLeft - container.scrollLeft,
      };
    }
  }, [activePageKey]);

  const ensureMonthsLoadedFor = useCallback((targetDate: Date, preloadMonths = PRELOAD_MONTHS) => {
    setMonthRange((prev) => {
      const next = expandMonthRange(prev, targetDate, preloadMonths);
      if (next === prev) return prev;
      if (next.startMonth.getTime() < prev.startMonth.getTime() && !prependAnchorRef.current) {
        capturePrependAnchor();
      }
      return next;
    });
  }, [capturePrependAnchor]);

  // One page per period (month or pay cycle) across the loaded month range, each 4 to 6 weeks tall
  const { pages, allDays } = useMemo(
    () => buildPeriodPages(periodsBetween(
      pageSetting,
      incomes,
      format(startOfMonth(monthRange.startMonth), 'yyyy-MM-dd'),
      format(endOfMonth(monthRange.endMonth), 'yyyy-MM-dd'),
    )),
    [pageSetting, incomes, monthRange.startMonth, monthRange.endMonth],
  );

  // Preserve exact horizontal scroll position when earlier months are prepended on the left
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor) return;
    prependAnchorRef.current = null;

    const container = scrollContainerRef.current;
    if (!container) return;

    const anchorEl = container.querySelector<HTMLElement>(`.calendar-month-page[data-page="${anchor.pageKey}"]`);
    if (anchorEl) {
      const targetScrollLeft = anchorEl.offsetLeft - anchor.relativeLeft;
      if (Math.abs(container.scrollLeft - targetScrollLeft) > 1) {
        ignoreMonthSyncUntilRef.current = Date.now() + 120;
        container.scrollLeft = targetScrollLeft;
        lastScrollLeftRef.current = targetScrollLeft;
      }
    }
  }, [monthRange.startMonth]);

  // Initial load: dates render immediately on client side; fetch visible 5 weeks first,
  // then preload 2 months before/after in week batches.
  useEffect(() => {
    const initial = resolvePage(format(currentDate, 'yyyy-MM-dd'));
    const visibleStart = startOfWeek(parseISO(initial.start), { weekStartsOn: 1 });
    const visibleEnd = startOfWeek(parseISO(initial.end), { weekStartsOn: 1 });
    visibleWeekKeysRef.current = getWeekKeysInRange(visibleStart, visibleEnd);

    const preloadStart = startOfWeek(startOfMonth(subMonths(currentDate, PRELOAD_MONTHS)), { weekStartsOn: 1 });
    const preloadEnd = startOfWeek(endOfMonth(addMonths(currentDate, PRELOAD_MONTHS)), { weekStartsOn: 1 });

    fetchedBoundsRef.current = {
      startWeek: preloadStart,
      endWeek: preloadEnd,
    };

    // Priority 1: Fetch the visible weeks of the current page
    fetchWeekBatch(visibleStart, visibleEnd);

    // Priority 2: Preload weeks for the 2 months before and 2 months after in week-sized chunks
    const timer = setTimeout(() => {
      let upCursor = subWeeks(visibleStart, 1);
      while (upCursor.getTime() >= preloadStart.getTime()) {
        const batchStart = subWeeks(upCursor, FETCH_WEEKS_STEP - 1);
        const clampedStart = batchStart.getTime() < preloadStart.getTime() ? preloadStart : batchStart;
        fetchWeekBatch(clampedStart, upCursor);
        upCursor = subWeeks(clampedStart, 1);
      }

      let downCursor = addWeeks(visibleEnd, 1);
      while (downCursor.getTime() <= preloadEnd.getTime()) {
        const batchEnd = addWeeks(downCursor, FETCH_WEEKS_STEP - 1);
        const clampedEnd = batchEnd.getTime() > preloadEnd.getTime() ? preloadEnd : batchEnd;
        fetchWeekBatch(downCursor, clampedEnd);
        downCursor = addWeeks(clampedEnd, 1);
      }
    }, 60);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute peaks per month so heatmap scale is calibrated per month
  const monthlyPeaks = useMemo(() => {
    const peaks: Record<string, number> = Object.create(null);
    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i];
      const mKey = format(day, 'yyyy-MM');
      const total = getTotalForDate(day, spendings);
      if (!peaks[mKey] || total > peaks[mKey]) {
        peaks[mKey] = total;
      }
    }
    return peaks;
  }, [allDays, spendings]);

  // Planned (not yet real) occurrences across every rendered day, grouped by date.
  const plannedByDate = useMemo(() => {
    const byDate = new Map<string, PlanOccurrence[]>();
    if (!allDays.length) return byDate;
    const items = projectedBetween(format(allDays[0], 'yyyy-MM-dd'), format(allDays[allDays.length - 1], 'yyyy-MM-dd'));
    for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
    return byDate;
  }, [allDays, projectedBetween]);

  // The page in view is the period the overview sums. Resolving its key (the page's first day) keeps this
  // right for one render while pages are rebuilt for another basis.
  const todayKey = todayString();
  const period = useMemo(() => resolvePage(activePageKey), [resolvePage, activePageKey]);
  // The active day: the day the header navigated to when it is on this page, else today or the page's first day.
  const shellDay = shellActiveDate ? format(shellActiveDate, "yyyy-MM-dd") : null;
  const activeDay = shellDay && shellDay >= period.start && shellDay <= period.end ? shellDay : pageAnchor(period, todayKey);
  const activeDayRef = useRef(activeDay);
  activeDayRef.current = activeDay;
  const periodDays = useMemo(
    () => eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) }),
    [period],
  );

  const { recurringIncome, oneTimeIncome, totalIncome } = getRangeIncome(period.start, period.end, incomes);

  const totalSpending = periodDays.reduce((sum, day) => sum + getTotalForDate(day, spendings), 0);
  // Planned occurrences in this period are projected by date range, so a period
  // outside the rendered calendar still gets its full forecast. Sure ones are committed, the rest are estimates.
  const periodProjected = projectedBetween(period.start, period.end);
  const periodCommitted = periodProjected.filter(item => item.sure).reduce((sum, item) => sum + item.amount, 0);
  const periodEstimates = periodProjected.filter(item => !item.sure).reduce((sum, item) => sum + item.amount, 0);
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const findPageElement = useCallback((container: HTMLElement, pageKey: string) => {
    return container.querySelector<HTMLElement>(`.calendar-month-page[data-page="${pageKey}"]`);
  }, []);

  // Jump to the page holding `date`: load its weeks first, then scroll it into view (now, or once it renders).
  const scrollToPageOf = useCallback((date: string, behavior: ScrollBehavior = 'smooth') => {
    const target = resolvePageRef.current(date);
    ensureMonthsLoadedFor(parseISO(target.start), PRELOAD_MONTHS + 1);

    const visibleStart = startOfWeek(parseISO(target.start), { weekStartsOn: 1 });
    const visibleEnd = startOfWeek(parseISO(target.end), { weekStartsOn: 1 });
    visibleWeekKeysRef.current = getWeekKeysInRange(visibleStart, visibleEnd);
    fetchWeekBatch(visibleStart, visibleEnd);

    pendingScrollRef.current = { key: target.start, behavior };
    setActivePageKey(target.start);
    setScrollTick(tick => tick + 1); // render even when the key is unchanged, so the pending scroll runs
    onActiveMonthChange?.(parseISO(pageAnchor(target, todayString())));
  }, [ensureMonthsLoadedFor, fetchWeekBatch, onActiveMonthChange]);

  const scrollToNextPage = useCallback(() => {
    scrollToPageOf(resolvePageRef.current(activePageKey).nextStart);
  }, [activePageKey, scrollToPageOf]);

  const scrollToPrevPage = useCallback(() => {
    scrollToPageOf(addDays(activePageKey, -1));
  }, [activePageKey, scrollToPageOf]);

  // Bring a pending page into view once it exists (the first render jumps there without animation).
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (!hasInitialScrolledRef.current) pendingScrollRef.current = { key: activePageKey, behavior: 'auto' };
    const pending = pendingScrollRef.current;
    if (!pending) return;
    const targetPage = findPageElement(container, pending.key);
    if (!targetPage) return;
    pendingScrollRef.current = null;
    hasInitialScrolledRef.current = true;
    if (pending.behavior === 'smooth' && Math.abs(container.scrollLeft - targetPage.offsetLeft) > 1) {
      ignoreMonthSyncUntilRef.current = Date.now() + 700;
      container.scrollTo({ left: targetPage.offsetLeft, behavior: 'smooth' });
    } else {
      ignoreMonthSyncUntilRef.current = Date.now() + 250;
      container.scrollLeft = targetPage.offsetLeft;
    }
    lastScrollLeftRef.current = targetPage.offsetLeft;
  });

  // Switching Month / Pay cycle, a pay cycle setting change, or incomes loading (a paycheck cycle needs
  // them) rebuilds the pages: keep the day the top bar shows in view on the new page. Resolving the old
  // page key with the new rules instead would land on the wrong period (1 Nov is in 5 Oct – 4 Nov).
  const shellDayRef = useRef(shellActiveDate);
  shellDayRef.current = shellActiveDate;
  const lastResolveRef = useRef(resolvePage);
  useLayoutEffect(() => {
    if (lastResolveRef.current === resolvePage) return;
    lastResolveRef.current = resolvePage;
    const day = shellDayRef.current ? format(shellDayRef.current, 'yyyy-MM-dd') : activeDayRef.current;
    const key = resolvePage(day).start;
    pendingScrollRef.current = { key, behavior: 'auto' };
    setActivePageKey(key);
    setScrollTick(tick => tick + 1);
  }, [resolvePage]);

  // Pages are sized to 100% of the container width, so a width change would otherwise
  // leave the old pixel scrollLeft pointing between pages.
  const activePageRef = useRef(activePageKey);
  useEffect(() => {
    activePageRef.current = activePageKey;
  }, [activePageKey]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      if (container.clientWidth === lastWidth) return;
      lastWidth = container.clientWidth;
      const targetPage = findPageElement(container, activePageRef.current);
      if (!targetPage) return;
      ignoreMonthSyncUntilRef.current = Date.now() + 250;
      container.scrollLeft = targetPage.offsetLeft;
      lastScrollLeftRef.current = targetPage.offsetLeft;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [findPageElement]);

  // Scroll ONLY when the external currentDate prop itself changes (the header's arrows or "today")
  useEffect(() => {
    if (!hasInitialScrolledRef.current) return;
    const targetDate = format(currentDate, 'yyyy-MM-dd');
    if (targetDate === lastExternalDateRef.current) return;
    lastExternalDateRef.current = targetDate;
    if (resolvePageRef.current(targetDate).start === activePageRef.current) return;
    scrollToPageOf(targetDate);
  }, [currentDate, scrollToPageOf]);

  // Horizontal scroll listener:
  // 1. Expands client-side calendar months before reaching left or right boundary
  // 2. Detects horizontal scroll direction ('left' / 'right') and fetches needed week batches
  // 3. Queues visible fetched days in the active month to fill in from left to right, top to bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerLeft = container.scrollLeft;
    const direction: ScrollDirection =
      containerLeft < lastScrollLeftRef.current
        ? 'left'
        : containerLeft > lastScrollLeftRef.current
          ? 'right'
          : 'idle';
    lastScrollLeftRef.current = containerLeft;

    const clientWidth = container.clientWidth || 800;
    const viewportCenter = containerLeft + clientWidth / 2;
    const pageEls = container.querySelectorAll<HTMLElement>('.calendar-month-page');
    if (pageEls.length === 0) return;

    let centerIdx = 0;
    for (let i = 0; i < pageEls.length; i++) {
      const page = pageEls[i];
      const pageRight = page.offsetLeft + page.offsetWidth;
      if (pageRight >= viewportCenter) {
        centerIdx = i;
        break;
      }
    }

    const centerPage = pageEls[centerIdx];

    // 1. Expand client-side calendar months when scrolling toward left or right boundary
    if (direction === 'left' && (centerIdx <= 1 || containerLeft < clientWidth)) {
      capturePrependAnchor(centerPage);
      setMonthRange((prev) => ({
        startMonth: startOfMonth(subMonths(prev.startMonth, 3)),
        endMonth: prev.endMonth,
      }));
    }
    if (
      direction !== 'left' &&
      (pageEls.length - 1 - centerIdx <= 1 ||
        container.scrollWidth - (containerLeft + clientWidth) < clientWidth)
    ) {
      setMonthRange((prev) => ({
        startMonth: prev.startMonth,
        endMonth: startOfMonth(addMonths(prev.endMonth, 3)),
      }));
    }

    // 2. Track the visible page's weeks and trigger left-to-right, top-to-bottom day reveal
    const centerKey = centerPage?.dataset.page;
    if (centerKey && centerPage.dataset.firstWeek && centerPage.dataset.lastWeek) {
      const visibleStartWeek = parseISO(centerPage.dataset.firstWeek);
      const visibleEndWeek = parseISO(centerPage.dataset.lastWeek);
      visibleWeekKeysRef.current = getWeekKeysInRange(visibleStartWeek, visibleEndWeek);
      enqueueVisibleFetchedDays();

      // Ensure visible weeks themselves are fetched if user jumped/scrolled fast past fetched bounds
      const missingVisibleWeeks = visibleWeekKeysRef.current.some(
        (k) => !fetchedWeeksRef.current.has(k),
      );
      if (missingVisibleWeeks) {
        fetchWeekBatch(visibleStartWeek, visibleEndWeek);
      }

      // 3. Compare current visible weeks with fetched week bounds in the detected scroll direction
      const effectiveDirection: ScrollDirection = direction === 'idle' ? 'right' : direction;
      const batch = getNextWeeksToFetch({
        direction: effectiveDirection,
        visibleStartWeek,
        visibleEndWeek,
        fetchedBounds: fetchedBoundsRef.current,
      });

      if (batch) {
        fetchedBoundsRef.current = batch.nextBounds;
        fetchWeekBatch(
          parseISO(batch.weekKeys[0]),
          parseISO(batch.weekKeys[batch.weekKeys.length - 1]),
        );
      }

      // 4. Update the header & overview to the page in view when not in the middle of a programmatic jump
      if (Date.now() >= ignoreMonthSyncUntilRef.current && centerKey !== activePageKey) {
        setActivePageKey(centerKey);
        ensureMonthsLoadedFor(parseISO(centerKey));
        onActiveMonthChange?.(parseISO(pageAnchor(resolvePageRef.current(centerKey), todayString())));
      }
    }
  }, [activePageKey, capturePrependAnchor, enqueueVisibleFetchedDays, ensureMonthsLoadedFor, fetchWeekBatch, onActiveMonthChange]);

  // Touch handlers for horizontal swipe (left to next month, right to prev month)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const diffX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const diffY = e.changedTouches[0].clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.4 && elapsed < 450) {
      if (diffX < 0) {
        scrollToNextPage();
      } else {
        scrollToPrevPage();
      }
    }
  };

  // Forward horizontal wheel events outside the grid to the horizontally scrollable month track
  const handleOuterWheel = (e: React.WheelEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (!container.contains(e.target as Node)) {
      const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      container.scrollLeft += delta;
    }
  };

  // Keyboard navigation for month-by-month side scrolling
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      scrollToNextPage();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      scrollToPrevPage();
    }
  };

  // The period summary sits beside the calendar on wide screens and above it, as a slim strip, on narrower ones.
  const summaryProps = {
    income: totalIncome,
    recurringIncome,
    oneTimeIncome,
    spent: totalSpending,
    committed: periodCommitted,
    estimates: periodEstimates,
    start: period.start,
    end: period.end,
    today: todayKey,
    // The period itself is named in the top bar, beside the Month / Pay cycle switch.
    tools: null,
  };
  // A small calendar of the other period kind: the pay cycle in Month view, the month in Pay cycle view.
  // Without a pay cycle set up, the cycle is the month itself, so Month view shows none.
  // It shows the period holding today when today is on the page, else the one that overlaps the page most.
  const miniSetting = basis === "cycle" ? CALENDAR_MONTHS : budgetPeriod;
  const miniPeriod = todayKey >= period.start && todayKey <= period.end
    ? periodOf(miniSetting, incomes, todayKey)
    : mostOverlapping(periodsBetween(miniSetting, incomes, period.start, period.end), period);
  const miniCalendar: MiniCalendarSpec | null = basis === "month" && miniPeriod.mode === "calendar" ? null : {
    title: basis === "cycle" ? format(parseISO(miniPeriod.start), "MMMM yyyy") : <>Pay cycle · {periodRangeLabel(miniPeriod)}</>,
    start: miniPeriod.start,
    end: miniPeriod.end,
    focusStart: period.start,
    focusEnd: period.end,
    onPick: date => onDateClick(parseISO(date)),
  };

  const payCycleHint = showPayCycleHint && (
    <p className="calendar-pay-cycle-hint" role="note">
      <span>Your payday is only saved on this device. </span>
      <Link href="/profile#paycycle">Set up your pay cycle</Link>
      <button type="button" onClick={dismissHint}>Dismiss</button>
    </p>
  );

  return (
    <div
      className="calendar-container"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onWheel={handleOuterWheel}
    >
      <div className="calendar-overview-grid calendar-summary-narrow">
        <PeriodStrip className="glass animate-fade-in" {...summaryProps}>{payCycleHint}</PeriodStrip>
      </div>

      <div className="calendar-weekdays-grid">
        <div className="calendar-weekday-label calendar-weeknum-header" aria-hidden="true" />
        {weekDays.map((day) => (
          <div key={day} className="calendar-weekday-label">
            {day}
          </div>
        ))}
      </div>

      <div
        className="calendar-days-grid hide-scrollbar"
        ref={scrollContainerRef}
        data-active-page={activePageKey}
        onScroll={handleScroll}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        role="region"
        aria-label={basis === "cycle" ? "Calendar pay cycles" : "Calendar months"}
      >
        {pages.map((page) => (
          <div
            key={page.key}
            className="calendar-month-page"
            data-page={page.key}
            data-first-week={format(page.weeks[0][0], 'yyyy-MM-dd')}
            data-last-week={format(page.weeks[page.weeks.length - 1][0], 'yyyy-MM-dd')}
            style={{ '--weeks': page.weeks.length } as React.CSSProperties}
          >
            {page.weeks.map((weekDaysList) => {
              const weekStartStr = format(weekDaysList[0], 'yyyy-MM-dd');
              const weekNumber = getWeekOfYear(weekDaysList[0]);
              const weekLabel = formatWeekOfYear(weekDaysList[0]);

              return (
                <div
                  key={`${page.key}-${weekStartStr}`}
                  className="calendar-week-row"
                  data-week={weekStartStr}
                  data-week-of-year={weekNumber}
                >
                  <div
                    className="calendar-week-number"
                    title={`Week ${weekNumber} of ${format(weekDaysList[3], 'yyyy')}`}
                    aria-label={`Week ${weekNumber}`}
                  >
                    {weekLabel}
                  </div>
                  {weekDaysList.map((day) => {
                    const dayKey = format(day, 'yyyy-MM-dd');
                    const dayMonthStr = format(day, 'yyyy-MM');
                    const isCurrentDay = isToday(day);
                    const isFirstOfMonth = day.getDate() === 1;
                    // Days of the neighbouring periods only fill the first and last week: faded, without amounts.
                    const isOutside = dayKey < page.start || dayKey > page.end;

                    // Stage per individual day: 'dates' (immediate) -> 'totals' (left-to-right, top-to-bottom) -> 'details'
                    const dayStage: WeekRenderStage = dayStages[dayKey] || 'dates';
                    const showTotals = !isOutside && (dayStage === 'totals' || dayStage === 'details');
                    const showDetails = !isOutside && dayStage === 'details';

                    const total = showTotals ? getTotalForDate(day, spendings) : 0;
                    const heatmapBg = showTotals
                      ? getHeatmapColor(total, monthlyPeaks[dayMonthStr] || 0, settings.theme)
                      : undefined;

                    const topSpendings = showDetails ? getTopSpendingsForDate(day, 5, spendings) : [];
                    const plannedItems = showTotals ? plannedByDate.get(dayKey) ?? [] : [];
                    const plannedTotal = plannedItems.reduce((sum, item) => sum + item.amount, 0);

                    return (
                      <div
                        key={`${page.key}-${dayKey}`}
                        onClick={() => onDateClick(day)}
                        data-day-stage={dayStage}
                        className={cn(
                          "glass calendar-day-cell",
                          isCurrentDay && "calendar-day-today",
                          isFirstOfMonth && "calendar-day-first-of-month",
                          isOutside && "calendar-day-outside",
                        )}
                        aria-current={isCurrentDay ? "date" : undefined}
                        title={isCurrentDay ? "Today" : undefined}
                        style={{
                          backgroundColor: heatmapBg || undefined,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.filter = "brightness(1.2)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.filter = "none";
                        }}
                      >
                        {/* Stage 1: Date value always renders immediately on the client side */}
                        <div className="calendar-day-header">
                          <span
                            className={cn(
                              "calendar-day-number",
                              isCurrentDay && "calendar-day-number-today",
                              isFirstOfMonth && "calendar-day-number-first",
                            )}
                          >
                            {isFirstOfMonth ? (
                              <>
                                <span className="calendar-day-first-badge">{format(day, "MMM")}</span>
                                <span>{format(day, "d")}</span>
                              </>
                            ) : (
                              format(day, "d")
                            )}
                          </span>
                          {showTotals && total > 0 && (
                            <span className="calendar-day-total-desktop">
                              {total.toLocaleString("vi-VN")} ₫
                            </span>
                          )}
                          {showTotals && total === 0 && plannedTotal > 0 && (
                            <span className="calendar-day-total-desktop calendar-day-planned-total" title="Planned, not spent yet">
                              ~{plannedTotal.toLocaleString("vi-VN")} ₫
                            </span>
                          )}
                        </div>

                        {showTotals && total > 0 && (
                          <div className="calendar-day-total-mobile">
                            {formatCompactSpending(total)}
                          </div>
                        )}
                        {showTotals && total === 0 && plannedTotal > 0 && (
                          <div className="calendar-day-total-mobile calendar-day-planned-total">
                            ~{formatCompactSpending(plannedTotal)}
                          </div>
                        )}

                        {/* Stage 3: Detailed spendings fill in after the day's total */}
                        {showDetails && (
                          <div className="calendar-spending-list">
                            {topSpendings.length === 0 && plannedItems.length === 0 && (
                              <span className="calendar-no-expenses">
                                No expenses
                              </span>
                            )}
                            {topSpendings.map((s, rowIdx) => (
                              <div
                                key={s.id}
                                className="calendar-spending-row"
                                style={{ '--row-idx': rowIdx } as React.CSSProperties}
                              >
                                <span className="calendar-spending-label" title={s.description}>
                                  <span className="calendar-spending-description">
                                    {s.description}
                                  </span>
                                </span>
                                <span className="calendar-spending-amount">
                                  {s.amount.toLocaleString("vi-VN")} ₫
                                </span>
                              </div>
                            ))}
                            {plannedItems.slice(0, Math.max(0, 5 - topSpendings.length)).map((p, plannedIdx) => (
                              <div
                                key={`plan-${p.planId}`}
                                className={cn("calendar-spending-row calendar-spending-row-planned", p.sure && "is-sure")}
                                style={{ '--row-idx': topSpendings.length + plannedIdx } as React.CSSProperties}
                                title={`Planned: ${p.description}`}
                              >
                                <span className="calendar-spending-label">
                                  <span className="calendar-spending-description">
                                    {p.description}
                                  </span>
                                </span>
                                <span className="calendar-spending-amount">
                                  ~{p.amount.toLocaleString("vi-VN")} ₫
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <PeriodSidePanel className="glass animate-fade-in calendar-summary-side" mini={miniCalendar} {...summaryProps}>
        {payCycleHint}
      </PeriodSidePanel>
    </div>
  );
};
