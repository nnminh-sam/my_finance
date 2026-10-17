'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  isToday,
  subMonths,
  addMonths,
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
  Edit2,
} from "lucide-react";
import { getTotalForDate, getTopSpendingsForDate, getSpendingsForDate, formatCompactSpending } from "../lib/spendings";
import { useFinance } from "../contexts/FinanceContext";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useSettings } from "../contexts/SettingsContext";
import { getHeatmapColor } from "../lib/heatmap";
import { getMonthIncome, incomeMonth } from "../lib/income";
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
  onEditIncome: (month?: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  currentDate,
  onActiveMonthChange,
  onDateClick,
  onEditIncome,
}) => {
  const { settings } = useSettings();
  const { spendings, incomeEntries } = useFinance();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = useRef(false);
  const hasInitialScrolledRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const [activeMonthStr, setActiveMonthStr] = useState<string>(() => format(currentDate, 'yyyy-MM'));

  // Stable anchor around initial mount date so range does not recompute on small date changes
  const anchorDate = useRef(currentDate).current;

  // Generate a multi-month continuous window of weeks (12 months before to 12 months after)
  const { weeks, allDays } = useMemo(() => {
    const startRangeMonth = startOfMonth(subMonths(anchorDate, 12));
    const endRangeMonth = endOfMonth(addMonths(anchorDate, 12));
    const rangeStartDate = startOfWeek(startRangeMonth, { weekStartsOn: 1 });
    const rangeEndDate = endOfWeek(endRangeMonth, { weekStartsOn: 1 });

    const daysList = eachDayOfInterval({ start: rangeStartDate, end: rangeEndDate });
    const weekList: Date[][] = [];
    for (let i = 0; i < daysList.length; i += 7) {
      weekList.push(daysList.slice(i, i + 7));
    }
    return { weeks: weekList, allDays: daysList };
  }, [anchorDate]);

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

  const { baseIncome, additionalIncome, totalIncome } = getMonthIncome(
    settings.income, incomeMonth(activeDate), incomeEntries,
  );

  const activeMonthStart = startOfMonth(activeDate);
  const activeMonthEnd = endOfMonth(activeMonthStart);
  const activeMonthDays = eachDayOfInterval({ start: activeMonthStart, end: activeMonthEnd });

  const categoryTotals: Record<string, number> = Object.create(null);
  activeMonthDays.forEach(day => {
    getSpendingsForDate(day, spendings).forEach(s => {
      categoryTotals[s.category] = (categoryTotals[s.category] || 0) + s.amount;
    });
  });

  const totalSpending = Object.values(categoryTotals).reduce((sum, amount) => sum + amount, 0);
  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const leftOver = totalIncome - totalSpending;
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Programmatic scroll helper to jump to a specific month
  const scrollToMonth = useCallback((targetMonth: Date) => {
    const targetMonthStr = format(targetMonth, 'yyyy-MM');
    const container = scrollContainerRef.current;
    if (!container) return;

    const targetWeek = container.querySelector<HTMLElement>(`[data-month="${targetMonthStr}"]`);
    if (targetWeek) {
      isProgrammaticScrollRef.current = true;
      targetWeek.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveMonthStr(targetMonthStr);
      onActiveMonthChange?.(targetMonth);

      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
    }
  }, [onActiveMonthChange]);

  const scrollToNextMonth = useCallback(() => {
    const current = parseISO(`${activeMonthStr}-01`);
    scrollToMonth(addMonths(current, 1));
  }, [activeMonthStr, scrollToMonth]);

  const scrollToPrevMonth = useCallback(() => {
    const current = parseISO(`${activeMonthStr}-01`);
    scrollToMonth(subMonths(current, 1));
  }, [activeMonthStr, scrollToMonth]);

  // Initial scroll into view on mount
  useEffect(() => {
    if (hasInitialScrolledRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const currentWeekStart = format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const targetWeek = container.querySelector<HTMLElement>(`[data-week="${currentWeekStart}"]`)
      || container.querySelector<HTMLElement>(`[data-month="${format(currentDate, 'yyyy-MM')}"]`);

    if (targetWeek) {
      isProgrammaticScrollRef.current = true;
      container.scrollTop = targetWeek.offsetTop;
      hasInitialScrolledRef.current = true;

      const timer = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentDate]);

  // Smoothly scroll when external currentDate prop changes to a new month
  useEffect(() => {
    if (!hasInitialScrolledRef.current) return;
    const targetMonthStr = format(currentDate, 'yyyy-MM');
    if (targetMonthStr === activeMonthStr) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const targetWeek = container.querySelector<HTMLElement>(`[data-month="${targetMonthStr}"]`);
    if (targetWeek) {
      isProgrammaticScrollRef.current = true;
      targetWeek.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveMonthStr(targetMonthStr);

      const timer = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentDate, activeMonthStr]);

  // Scroll listener tracking the dominant visible week row to update active month
  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerTop = container.scrollTop;
    const offsetCheck = containerTop + 60;
    const weekRows = container.querySelectorAll<HTMLElement>('.calendar-week-row');

    let currentWeekRow: HTMLElement | null = null;
    for (let i = 0; i < weekRows.length; i++) {
      const row = weekRows[i];
      if (row.offsetTop + row.offsetHeight >= offsetCheck) {
        currentWeekRow = row;
        break;
      }
    }

    if (currentWeekRow && currentWeekRow.dataset.month) {
      const newMonth = currentWeekRow.dataset.month;
      if (newMonth !== activeMonthStr) {
        setActiveMonthStr(newMonth);
        try {
          const newDate = parseISO(`${newMonth}-01`);
          onActiveMonthChange?.(newDate);
        } catch {
          // ignore
        }
      }
    }
  }, [activeMonthStr, onActiveMonthChange]);

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
      container.scrollBy({ top: weekHeight * 4, behavior: 'smooth' });
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      container.scrollBy({ top: -weekHeight * 4, behavior: 'smooth' });
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
                <span className="hide-mobile">Monthly </span>Income
              </span>
              <button
                type="button"
                className="overview-income-edit"
                onClick={() => onEditIncome(incomeMonth(activeDate))}
                aria-label={`Edit additional income for ${format(activeDate, 'MMMM yyyy')}`}
                aria-haspopup="dialog"
              >
                <Edit2 size={12} aria-hidden="true" /><span className="hide-mobile">Edit</span>
              </button>
            </div>
            <span className="calendar-stat-value calendar-stat-income-value">
              {totalIncome.toLocaleString("vi-VN")} ₫
            </span>
          </div>

          <div className="calendar-overview-stat calendar-overview-spending">
            <span className="calendar-stat-label">
              <span className="hide-mobile">Total </span>Spending
            </span>
            <span className="calendar-stat-value calendar-stat-spending-value">
              {totalSpending.toLocaleString("vi-VN")} ₫
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
              {totalIncome > 0 ? `${leftOver.toLocaleString("vi-VN")} ₫` : <><span className="hide-mobile">Income </span>Not set</>}
            </span>
          </div>

          <div className="calendar-stat-subtext">
            <span className="hide-mobile">Recurring base </span><span className="show-mobile">Base </span>{baseIncome.toLocaleString("vi-VN")} ₫ · <span className="hide-mobile">Additional </span><span className="show-mobile">Extra </span>{additionalIncome.toLocaleString("vi-VN")} ₫
          </div>
        </div>

        {/* Card 2: Top Categories */}
        <div className="glass animate-fade-in calendar-top-categories-card">
          <div className="calendar-top-categories-title">
            Top 5 Categories This Month
          </div>
          <div className="calendar-top-categories-list hide-scrollbar">
            {topCategories.map(([categoryId, amount]) => {
              const catData = settings.categories?.find(c => c.id === categoryId) || { name: categoryId, icon: 'CircleDollarSign' };
              return (
                <div key={categoryId} style={{ display: "flex", flexDirection: "column", minWidth: "120px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)" }}>
                    <CategoryIcon iconName={catData.icon} size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catData.name}</span>
                  </div>
                  <div style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)", marginTop: "4px" }}>
                    {amount.toLocaleString("vi-VN")} ₫
                  </div>
                </div>
              );
            })}
            {topCategories.length === 0 && (
              <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", padding: "8px 0" }}>
                No spending data for this month.
              </div>
            )}
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
                const total = getTotalForDate(day, spendings);
                const topSpendings = getTopSpendingsForDate(day, 5, spendings);
                const dayMonthStr = format(day, 'yyyy-MM');
                const heatmapBg = getHeatmapColor(
                  total,
                  monthlyPeaks[dayMonthStr] || 0,
                  settings.theme,
                );
                const isCurrentDay = isToday(day);
                const isFirstOfMonth = day.getDate() === 1;
                const isDifferentMonth = dayMonthStr !== activeMonthStr;

                return (
                  <div
                    key={format(day, 'yyyy-MM-dd')}
                    onClick={() => onDateClick(day)}
                    className={cn(
                      "glass calendar-day-cell",
                      isCurrentDay && "calendar-day-today",
                      isFirstOfMonth && "calendar-day-first-of-month",
                      isDifferentMonth && "calendar-day-other-month",
                    )}
                    aria-current={isCurrentDay ? "date" : undefined}
                    title={isCurrentDay ? "Today" : undefined}
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
                      {total > 0 && (
                        <span className="calendar-day-total-desktop">
                          {total.toLocaleString("vi-VN")} ₫
                        </span>
                      )}
                    </div>

                    {total > 0 && (
                      <div className="calendar-day-total-mobile">
                        {formatCompactSpending(total)}
                      </div>
                    )}

                    <div className="calendar-spending-list">
                      {topSpendings.length === 0 && (
                        <span className="calendar-no-expenses">
                          No expenses
                        </span>
                      )}
                      {topSpendings.map((s) => (
                        <div key={s.id} className="calendar-spending-row">
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
