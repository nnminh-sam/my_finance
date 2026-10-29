'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  Utensils,
  Car,
  Film,
  ShoppingBag,
  Receipt,
  CircleDollarSign,
  Coffee,
  Home,
  Heart,
  Briefcase,
  Gift,
  Phone,
} from "lucide-react";
import { getTotalForDate, getTopSpendingsForDate, formatCompactSpending } from "../lib/spendings";
import {
  FETCH_WEEKS_STEP,
  PRELOAD_MONTHS,
  VISIBLE_WEEKS,
  buildCalendarWeeks,
  createInitialMonthRange,
  detectScrollDirection,
  expandMonthRange,
  getMonthFirstWeekKey,
  getNextWeeksToFetch,
  getWeekKeysInRange,
} from "../lib/calendarWindow";
import type { FetchedWeekBounds, MonthRange, WeekRenderStage } from "../lib/calendarWindow";
import { useFinance } from "../contexts/FinanceContext";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useSettings } from "../contexts/SettingsContext";
import { getHeatmapColor } from "../lib/heatmap";
import { getMonthIncome, incomeMonth } from "../lib/income";
import { defaultSalaryCycleConfig, getSalaryCycleForMonth, loadSalaryCycleConfig } from "../lib/salaryCycle";
import type { SalaryCycleConfig } from "../lib/salaryCycle";
import { useAuth } from "../contexts/AuthContext";
import "../styles/CalendarView.css";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const ICONS = { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone };

const CategoryIcon = ({
  iconName,
  size = 12,
}: {
  iconName: string;
  size?: number;
}) => {
  const IconComp = ICONS[iconName as keyof typeof ICONS] || CircleDollarSign;
  return <IconComp size={size} />;
};

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
  const { spendings, incomes, fetchWeeksSpendings } = useFinance();
  const { user } = useAuth();
  const [cycleConfig, setCycleConfig] = useState<SalaryCycleConfig>(() => defaultSalaryCycleConfig());

  // Pay cycle preferences are edited in Profile; load them for the signed-in user.
  useEffect(() => {
    setCycleConfig(loadSalaryCycleConfig(user?.id));
  }, [user?.id]);

  // A day is a cycle boundary when it is the first or last day of a cycle anchored nearby.
  const cycleBoundary = useCallback((day: Date) => {
    const key = format(day, "yyyy-MM-dd");
    let isStart = false;
    let isEnd = false;
    for (const offset of [-1, 0, 1]) {
      const cycle = getSalaryCycleForMonth(new Date(day.getFullYear(), day.getMonth() + offset, 1), cycleConfig);
      if (format(cycle.startDate, "yyyy-MM-dd") === key) isStart = true;
      if (format(cycle.endDate, "yyyy-MM-dd") === key) isEnd = true;
    }
    return { isStart, isEnd };
  }, [cycleConfig]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const ignoreMonthSyncUntilRef = useRef<number>(0);
  const hasInitialScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastExternalMonthRef = useRef<string>(format(currentDate, 'yyyy-MM'));
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const prependAnchorRef = useRef<{
    weekKey: string;
    relativeTop: number;
  } | null>(null);

  const [activeMonthStr, setActiveMonthStr] = useState<string>(() => format(currentDate, 'yyyy-MM'));

  // Preload 2 months before and 2 months after the initial month, expanding dynamically on scroll
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
    const firstVisible = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    return {
      startWeek: firstVisible,
      endWeek: addWeeks(firstVisible, VISIBLE_WEEKS - 1),
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

  const capturePrependAnchor = useCallback((anchorRow?: HTMLElement | null) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const row = anchorRow || container.querySelector<HTMLElement>('.calendar-week-row');
    if (row && row.dataset.week) {
      prependAnchorRef.current = {
        weekKey: row.dataset.week,
        relativeTop: row.offsetTop - container.scrollTop,
      };
    }
  }, []);

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

  // Generate continuous client-side weeks for the currently loaded month range
  const { weeks, allDays } = useMemo(
    () => buildCalendarWeeks(monthRange.startMonth, monthRange.endMonth),
    [monthRange.startMonth, monthRange.endMonth],
  );

  // Preserve exact scroll position when earlier weeks are prepended at the top
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor) return;
    prependAnchorRef.current = null;

    const container = scrollContainerRef.current;
    if (!container) return;

    const anchorEl = container.querySelector<HTMLElement>(`[data-week="${anchor.weekKey}"]`);
    if (anchorEl) {
      const targetScrollTop = anchorEl.offsetTop - anchor.relativeTop;
      if (Math.abs(container.scrollTop - targetScrollTop) > 1) {
        ignoreMonthSyncUntilRef.current = Date.now() + 120;
        container.scrollTop = targetScrollTop;
        lastScrollTopRef.current = targetScrollTop;
      }
    }
  }, [monthRange.startMonth]);

  // Initial load: dates render immediately on client side; fetch visible 5 weeks first,
  // then preload 2 months before/after in week batches.
  useEffect(() => {
    const visibleStart = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    const visibleEnd = addWeeks(visibleStart, VISIBLE_WEEKS - 1);
    visibleWeekKeysRef.current = getWeekKeysInRange(visibleStart, visibleEnd);

    const preloadStart = startOfWeek(startOfMonth(subMonths(currentDate, PRELOAD_MONTHS)), { weekStartsOn: 1 });
    const preloadEnd = startOfWeek(endOfMonth(addMonths(currentDate, PRELOAD_MONTHS)), { weekStartsOn: 1 });

    fetchedBoundsRef.current = {
      startWeek: preloadStart,
      endWeek: preloadEnd,
    };

    // Priority 1: Fetch the 5 visible weeks of the current month
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

  // Active month date for overview metrics
  const activeDate = useMemo(() => {
    try {
      return parseISO(`${activeMonthStr}-01`);
    } catch {
      return currentDate;
    }
  }, [activeMonthStr, currentDate]);

  // Totals can follow the calendar month or the pay cycle that starts in the active month.
  const [basis, setBasis] = useState<"month" | "cycle">("month");
  const cycle = useMemo(() => getSalaryCycleForMonth(activeDate, cycleConfig), [activeDate, cycleConfig]);
  const periodDays = useMemo(
    () => (basis === "cycle" ? cycle.days : eachDayOfInterval({ start: startOfMonth(activeDate), end: endOfMonth(activeDate) })),
    [basis, cycle, activeDate],
  );

  const { recurringIncome, oneTimeIncome, totalIncome } = getMonthIncome(
    basis === "cycle" ? cycle.cycleMonth : incomeMonth(activeDate), incomes,
  );

  const totalSpending = periodDays.reduce((sum, day) => sum + getTotalForDate(day, spendings), 0);
  const leftOver = totalIncome - totalSpending;
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const findMonthStartElement = useCallback((container: HTMLElement, targetMonth: Date) => {
    const firstWeekKey = getMonthFirstWeekKey(targetMonth);
    const targetMonthStr = format(targetMonth, 'yyyy-MM');
    return (
      container.querySelector<HTMLElement>(`[data-week="${firstWeekKey}"]`) ||
      container.querySelector<HTMLElement>(`[data-month="${targetMonthStr}"]`)
    );
  }, []);

  // Programmatic scroll helper to jump to a specific month
  const scrollToMonth = useCallback((targetMonth: Date) => {
    const targetMonthStr = format(targetMonth, 'yyyy-MM');
    ensureMonthsLoadedFor(targetMonth, PRELOAD_MONTHS + 1);

    const visibleStart = startOfWeek(startOfMonth(targetMonth), { weekStartsOn: 1 });
    const visibleEnd = addWeeks(visibleStart, VISIBLE_WEEKS - 1);
    visibleWeekKeysRef.current = getWeekKeysInRange(visibleStart, visibleEnd);
    fetchWeekBatch(visibleStart, visibleEnd);

    const container = scrollContainerRef.current;
    if (!container) return;

    const targetWeek = findMonthStartElement(container, targetMonth);
    if (targetWeek) {
      ignoreMonthSyncUntilRef.current = Date.now() + 450;
      targetWeek.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveMonthStr(targetMonthStr);
      onActiveMonthChange?.(targetMonth);
    }
  }, [ensureMonthsLoadedFor, fetchWeekBatch, findMonthStartElement, onActiveMonthChange]);

  const scrollToNextMonth = useCallback(() => {
    const current = parseISO(`${activeMonthStr}-01`);
    scrollToMonth(addMonths(current, 1));
  }, [activeMonthStr, scrollToMonth]);

  const scrollToPrevMonth = useCallback(() => {
    const current = parseISO(`${activeMonthStr}-01`);
    scrollToMonth(subMonths(current, 1));
  }, [activeMonthStr, scrollToMonth]);

  // Initial scroll into view on mount: align the first week of the current month at the top so 5 weeks of the month are visible
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (!hasInitialScrolledRef.current) {
      const targetWeek = findMonthStartElement(container, currentDate);
      if (targetWeek) {
        ignoreMonthSyncUntilRef.current = Date.now() + 250;
        container.scrollTop = targetWeek.offsetTop;
        lastScrollTopRef.current = targetWeek.offsetTop;
        hasInitialScrolledRef.current = true;
      }
    }
  }, [currentDate, findMonthStartElement]);

  // Rows are sized as a share of the container, so a height change (for example the overview card
  // wrapping) would otherwise leave the old pixel scrollTop pointing at the wrong week.
  const activeMonthRef = useRef(activeMonthStr);
  useEffect(() => {
    activeMonthRef.current = activeMonthStr;
  }, [activeMonthStr]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let lastHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      if (container.clientHeight === lastHeight) return;
      lastHeight = container.clientHeight;
      const targetWeek = findMonthStartElement(container, parseISO(`${activeMonthRef.current}-01`));
      if (!targetWeek) return;
      ignoreMonthSyncUntilRef.current = Date.now() + 250;
      container.scrollTop = targetWeek.offsetTop;
      lastScrollTopRef.current = targetWeek.offsetTop;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [findMonthStartElement]);

  // Smoothly scroll ONLY when the external currentDate prop itself changes to a new month
  useEffect(() => {
    if (!hasInitialScrolledRef.current) return;
    const targetMonthStr = format(currentDate, 'yyyy-MM');
    if (targetMonthStr === lastExternalMonthRef.current) return;
    lastExternalMonthRef.current = targetMonthStr;

    if (targetMonthStr === activeMonthStr) return;

    ensureMonthsLoadedFor(currentDate, PRELOAD_MONTHS + 1);
    const visibleStart = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    const visibleEnd = addWeeks(visibleStart, VISIBLE_WEEKS - 1);
    visibleWeekKeysRef.current = getWeekKeysInRange(visibleStart, visibleEnd);
    fetchWeekBatch(visibleStart, visibleEnd);

    const container = scrollContainerRef.current;
    if (!container) return;

    const targetWeek = findMonthStartElement(container, currentDate);
    if (targetWeek) {
      ignoreMonthSyncUntilRef.current = Date.now() + 450;
      targetWeek.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveMonthStr(targetMonthStr);
    }
  }, [currentDate, activeMonthStr, ensureMonthsLoadedFor, fetchWeekBatch, findMonthStartElement]);

  // Scroll listener:
  // 1. Always expands client-side calendar dates well before reaching top or bottom boundary (never stuck at Jan 3rd!)
  // 2. Detects scroll direction ('up' / 'down') and compares current visible week against fetched weeks
  // 3. Queues visible fetched days to fill in from left to right, top to bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerTop = container.scrollTop;
    const direction = detectScrollDirection(containerTop, lastScrollTopRef.current);
    lastScrollTopRef.current = containerTop;

    const clientHeight = container.clientHeight || 500;
    const viewportCenter = containerTop + clientHeight / 2;
    const viewportBottom = containerTop + clientHeight - 8;
    const weekRows = container.querySelectorAll<HTMLElement>('.calendar-week-row');
    if (weekRows.length === 0) return;

    let topVisibleIdx = 0;
    let foundTop = false;
    let centerWeekRow: HTMLElement | null = null;
    let bottomVisibleIdx = weekRows.length - 1;

    for (let i = 0; i < weekRows.length; i++) {
      const row = weekRows[i];
      const rowBottom = row.offsetTop + row.offsetHeight;
      if (!foundTop && rowBottom > containerTop + 4) {
        topVisibleIdx = i;
        foundTop = true;
      }
      if (!centerWeekRow && rowBottom >= viewportCenter) {
        centerWeekRow = row;
      }
      if (row.offsetTop <= viewportBottom) {
        bottomVisibleIdx = i;
      } else if (foundTop) {
        break;
      }
    }

    const topVisibleRow = weekRows[topVisibleIdx];
    const bottomVisibleRow = weekRows[bottomVisibleIdx];

    // 1. Expand client-side calendar dates when scrolling toward top or bottom boundary
    if (direction === 'up' && (topVisibleIdx <= 4 || containerTop < clientHeight)) {
      capturePrependAnchor(topVisibleRow);
      setMonthRange((prev) => ({
        startMonth: startOfMonth(subMonths(prev.startMonth, 3)),
        endMonth: prev.endMonth,
      }));
    }
    if (
      direction !== 'up' &&
      (weekRows.length - 1 - bottomVisibleIdx <= 4 ||
        container.scrollHeight - (containerTop + clientHeight) < clientHeight)
    ) {
      setMonthRange((prev) => ({
        startMonth: prev.startMonth,
        endMonth: startOfMonth(addMonths(prev.endMonth, 3)),
      }));
    }

    // 2. Track currently visible weeks and trigger left-to-right, top-to-bottom day reveal
    if (topVisibleRow?.dataset.week && bottomVisibleRow?.dataset.week) {
      const visibleStartWeek = parseISO(topVisibleRow.dataset.week);
      const visibleEndWeek = parseISO(bottomVisibleRow.dataset.week);
      visibleWeekKeysRef.current = getWeekKeysInRange(visibleStartWeek, visibleEndWeek);
      enqueueVisibleFetchedDays();

      // Ensure visible weeks themselves are fetched if user jumped/scrolled fast past fetched bounds
      const missingVisibleWeeks = visibleWeekKeysRef.current.some(
        (k) => !fetchedWeeksRef.current.has(k),
      );
      if (missingVisibleWeeks) {
        fetchWeekBatch(visibleStartWeek, visibleEndWeek);
      }

      // 3. Compare current visible week with fetched week bounds in the detected scroll direction
      const effectiveDirection = direction === 'idle' ? 'down' : direction;
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
    }

    // 4. Update active month header & overview when not in the middle of a programmatic jump
    if (Date.now() >= ignoreMonthSyncUntilRef.current && centerWeekRow?.dataset.month) {
      const newMonth = centerWeekRow.dataset.month;
      if (newMonth !== activeMonthStr) {
        setActiveMonthStr(newMonth);
        try {
          const newDate = parseISO(`${newMonth}-01`);
          ensureMonthsLoadedFor(newDate);
          onActiveMonthChange?.(newDate);
        } catch {
          // ignore
        }
      }
    }
  }, [activeMonthStr, capturePrependAnchor, enqueueVisibleFetchedDays, ensureMonthsLoadedFor, fetchWeekBatch, onActiveMonthChange]);

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
        scrollToNextMonth();
      } else {
        scrollToPrevMonth();
      }
    }
  };

  // Forward outer wheel events to the scrollable grid
  const handleOuterWheel = (e: React.WheelEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (!container.contains(e.target as Node)) {
      container.scrollTop += e.deltaY;
    }
  };

  // Keyboard navigation for week-by-week scrolling
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const weekEl = container.querySelector<HTMLElement>('.calendar-week-row');
    const weekHeight = weekEl ? weekEl.offsetHeight + 8 : 100;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      container.scrollBy({ top: weekHeight, behavior: 'smooth' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      container.scrollBy({ top: -weekHeight, behavior: 'smooth' });
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      container.scrollBy({ top: weekHeight * 5, behavior: 'smooth' });
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      container.scrollBy({ top: -weekHeight * 5, behavior: 'smooth' });
    }
  };

  return (
    <div
      className="calendar-container"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onWheel={handleOuterWheel}
    >
      <div className="calendar-overview-grid">
        {/* Card 1: Overview */}
        <div className="glass animate-fade-in calendar-overview-card">
          <div className="calendar-overview-stat calendar-overview-income">
            <div className="overview-income-heading">
              <span className="calendar-stat-label">
                <span className="hide-mobile">{basis === "cycle" ? "Cycle" : "Monthly"} </span>Income
              </span>
            </div>
            <span className="calendar-stat-value calendar-stat-income-value">
              <span className="hide-mobile">{totalIncome.toLocaleString("vi-VN")} ₫</span>
              <span className="show-mobile">{formatCompactSpending(totalIncome)}</span>
            </span>
          </div>

          <div className="calendar-overview-stat calendar-overview-spending">
            <span className="calendar-stat-label">
              <span className="hide-mobile">Total </span>Spending
            </span>
            <span className="calendar-stat-value calendar-stat-spending-value">
              <span className="hide-mobile">{totalSpending.toLocaleString("vi-VN")} ₫</span>
              <span className="show-mobile">{formatCompactSpending(totalSpending)}</span>
            </span>
          </div>

          <div className="calendar-overview-stat calendar-overview-leftover">
            <span className="calendar-stat-label">
              Left Over
            </span>
            <span
              className="calendar-stat-value"
              style={{
                color: totalIncome > 0 ? (leftOver >= 0 ? "var(--primary)" : "var(--danger)") : "var(--text-muted)",
              }}
            >
              {totalIncome > 0 ? (
                <>
                  <span className="hide-mobile">{leftOver.toLocaleString("vi-VN")} ₫</span>
                  <span className="show-mobile">{formatCompactSpending(leftOver)}</span>
                </>
              ) : (
                <><span className="hide-mobile">Income </span>Not set</>
              )}
            </span>
          </div>

          <div className="calendar-stat-subtext calendar-stat-subtext-row">
            <span>
            <span className="hide-mobile">
              Recurring {recurringIncome.toLocaleString("vi-VN")} ₫ · One-time {oneTimeIncome.toLocaleString("vi-VN")} ₫
            </span>
            <span className="show-mobile">
              Recur. {formatCompactSpending(recurringIncome)} · Once {formatCompactSpending(oneTimeIncome)}
            </span>
            <span className="calendar-basis-range">
              {" · "}{basis === "cycle" ? `${format(cycle.startDate, "MMM d")} – ${format(cycle.endDate, "MMM d")}` : format(activeDate, "MMMM")}
            </span>
            </span>
            <div className="calendar-basis-toggle" role="group" aria-label="Totals calculated for">
              <button type="button" aria-pressed={basis === "month"} onClick={() => setBasis("month")}>Month</button>
              <button type="button" aria-pressed={basis === "cycle"} onClick={() => setBasis("cycle")}>Pay cycle</button>
            </div>
          </div>
        </div>
      </div>

      <div className="calendar-weekdays-grid">
        {weekDays.map((day) => (
          <div key={day} className="calendar-weekday-label">
            {day}
          </div>
        ))}
      </div>

      <div
        className="calendar-days-grid hide-scrollbar"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        role="region"
        aria-label="Calendar weeks"
      >
        {weeks.map((weekDaysList) => {
          const weekStartStr = format(weekDaysList[0], 'yyyy-MM-dd');
          const dominantMonthStr = format(weekDaysList[3], 'yyyy-MM');

          return (
            <div
              key={weekStartStr}
              className="calendar-week-row"
              data-week={weekStartStr}
              data-month={dominantMonthStr}
            >
              {weekDaysList.map((day) => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const dayMonthStr = format(day, 'yyyy-MM');
                const isCurrentDay = isToday(day);
                const isFirstOfMonth = day.getDate() === 1;
                const isDifferentMonth = dayMonthStr !== activeMonthStr;
                const { isStart: isCycleStart, isEnd: isCycleEnd } = cycleBoundary(day);

                // Stage per individual day: 'dates' (immediate) -> 'totals' (left-to-right, top-to-bottom) -> 'details'
                const dayStage: WeekRenderStage = dayStages[dayKey] || 'dates';
                const showTotals = dayStage === 'totals' || dayStage === 'details';
                const showDetails = dayStage === 'details';

                const total = showTotals ? getTotalForDate(day, spendings) : 0;
                const heatmapBg = showTotals
                  ? getHeatmapColor(total, monthlyPeaks[dayMonthStr] || 0, settings.theme)
                  : undefined;

                const topSpendings = showDetails ? getTopSpendingsForDate(day, 5, spendings) : [];

                return (
                  <div
                    key={dayKey}
                    onClick={() => onDateClick(day)}
                    data-day-stage={dayStage}
                    className={cn(
                      "glass calendar-day-cell",
                      isCurrentDay && "calendar-day-today",
                      isFirstOfMonth && "calendar-day-first-of-month",
                      isDifferentMonth && "calendar-day-other-month",
                       isCycleStart && "calendar-day-cycle-start",
                       isCycleEnd && "calendar-day-cycle-end",
                    )}
                    aria-current={isCurrentDay ? "date" : undefined}
                    title={isCycleStart ? "Pay cycle starts" : isCycleEnd ? "Pay cycle ends" : isCurrentDay ? "Today" : undefined}
                    style={{
                      backgroundColor: heatmapBg || undefined,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.filter = "brightness(1.2)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
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
                    </div>

                    {showTotals && total > 0 && (
                      <div className="calendar-day-total-mobile">
                        {formatCompactSpending(total)}
                      </div>
                    )}

                    {/* Stage 3: Detailed spendings fill in after the day's total */}
                    {showDetails && (
                      <div className="calendar-spending-list">
                        {topSpendings.length === 0 && (
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
                              <span className="calendar-spending-icon">
                                <CategoryIcon iconName={settings.categories.find(c => c.id === s.category)?.icon || "CircleDollarSign"} size={12} />
                              </span>
                              <span className="calendar-spending-description">
                                {s.description}
                              </span>
                            </span>
                            <span className="calendar-spending-amount">
                              {s.amount.toLocaleString("vi-VN")} ₫
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
    </div>
  );
};
