'use client';

import React, { useRef } from 'react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, startOfMonth, endOfMonth, addWeeks, subWeeks } from 'date-fns';
import { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone } from "lucide-react";
import { getSpendingsForDate, getTotalForDate, formatCompactSpending } from '../lib/spendings';
import { useFinance } from '../contexts/FinanceContext';
import { useSettings } from '../contexts/SettingsContext';
import { getHeatmapColor } from '../lib/heatmap';
import { getMonthIncome, incomeMonth } from '../lib/income';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import '../styles/WeekView.css';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const ICONS = { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone };

const CategoryIcon = ({ iconName, size = 12 }: { iconName: string, size?: number }) => {
  const IconComp = ICONS[iconName as keyof typeof ICONS] || CircleDollarSign;
  return <IconComp size={size} />;
};

interface WeekViewProps {
  currentDate: Date;
  onDateClick: (date: Date) => void;
  onNavigateDate?: (date: Date) => void;
  onEditIncome?: () => void;
}

export const WeekView: React.FC<WeekViewProps> = ({ currentDate, onDateClick, onNavigateDate }) => {
  const { settings } = useSettings();
  const { spendings, incomeEntries } = useFinance();
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const mobileDayCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || !onNavigateDate) return;
    const diffX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const diffY = e.changedTouches[0].clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.4 && elapsed < 450) {
      if (diffX < 0) {
        onNavigateDate(addWeeks(currentDate, 1));
      } else {
        onNavigateDate(subWeeks(currentDate, 1));
      }
    }
  };

  const { baseIncome, additionalIncome, totalIncome } = getMonthIncome(
    settings.income, incomeMonth(currentDate), incomeEntries,
  );
  const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
  const endDate = endOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  // Share the selected month's peak with CalendarView, including cross-month cells.
  const monthlyPeak = Math.max(0, ...monthDays.map(day => getTotalForDate(day, spendings)));

  const categoryTotals: Record<string, number> = Object.create(null);
  monthDays.forEach(day => {
    getSpendingsForDate(day, spendings).forEach(s => {
      categoryTotals[s.category] = (categoryTotals[s.category] || 0) + s.amount;
    });
  });

  const totalMonthSpending = Object.values(categoryTotals).reduce((sum, amount) => sum + amount, 0);
  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const leftOver = totalIncome - totalMonthSpending;

  const totalWeekSpending = days.reduce((sum, day) => sum + getTotalForDate(day, spendings), 0);
  const weekRangeLabel = `${format(startDate, 'MMM d')} – ${format(endDate, 'MMM d')}`;

  return (
    <div
      className="week-container animate-fade-in"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Desktop Overview & Top Categories */}
      <div className="week-overview-grid">
        {/* Card 1: Overview */}
        <div className="week-overview-card glass">
          <div className="week-overview-stat week-overview-income">
            <div className="overview-income-heading">
              <span className="week-stat-label">Income</span>
            </div>
            <span className="week-stat-value week-stat-income-value">
              <span className="hide-mobile">{totalIncome.toLocaleString('vi-VN')} ₫</span>
              <span className="show-mobile">{formatCompactSpending(totalIncome)}</span>
            </span>
          </div>

          <div className="week-overview-stat week-overview-spending">
            <span className="week-stat-label">Spending</span>
            <span className="week-stat-value week-stat-spending-value">
              <span className="hide-mobile">{totalWeekSpending.toLocaleString('vi-VN')} ₫</span>
              <span className="show-mobile">{formatCompactSpending(totalWeekSpending)}</span>
            </span>
          </div>

          <div className="week-overview-stat week-overview-leftover">
            <span className="week-stat-label">Left Over</span>
            <span
              className="week-stat-value"
              style={{
                color: totalIncome > 0
                  ? (leftOver >= 0 ? "var(--primary)" : "var(--danger)")
                  : "var(--text-muted)"
              }}
            >
              {totalIncome > 0 ? (
                <>
                  <span className="hide-mobile">{leftOver.toLocaleString('vi-VN')} ₫</span>
                  <span className="show-mobile">{formatCompactSpending(leftOver)}</span>
                </>
              ) : (
                "Not set"
              )}
            </span>
          </div>

          <div className="week-stat-subtext">
            <span className="hide-mobile">
              Recurring base {baseIncome.toLocaleString('vi-VN')} ₫ · Additional {additionalIncome.toLocaleString('vi-VN')} ₫
            </span>
            <span className="show-mobile">
              Base {formatCompactSpending(baseIncome)} · Extra {formatCompactSpending(additionalIncome)}
            </span>
          </div>
        </div>

        {/* Card 2: Top Categories */}
        <div className="week-top-categories-card glass animate-fade-in">
          <div className="week-top-categories-title">
            Top 5 Categories This Month
          </div>
          <div className="week-top-categories-list hide-scrollbar">
            {topCategories.map(([categoryId, amount]) => {
              const catData = settings.categories?.find(c => c.id === categoryId) || { name: categoryId, icon: 'CircleDollarSign' };
              return (
                <div key={categoryId} className="week-top-category-item">
                  <div className="week-top-category-header">
                    <CategoryIcon iconName={catData.icon} size={14} />
                    <span className="week-top-category-name">{catData.name}</span>
                  </div>
                  <div className="week-top-category-amount">
                    {amount.toLocaleString("vi-VN")} ₫
                  </div>
                </div>
              );
            })}
            {topCategories.length === 0 && (
              <div className="week-no-categories">
                No spending data for this month.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Week Header & Day Strip */}
      <div className="week-mobile-summary">
        <div className="week-mobile-title-row">
          <h2 className="week-mobile-title">This Week</h2>
          <span className="week-mobile-range">{weekRangeLabel}</span>
        </div>

        <div className="week-mobile-strip">
          {days.map((day) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const isCurrentDay = isToday(day);
            const dayTotal = getTotalForDate(day, spendings);
            return (
              <button
                key={dayKey}
                type="button"
                className={cn('week-strip-day', isCurrentDay && 'is-today')}
                onClick={() => {
                  const targetEl = mobileDayCardRefs.current[dayKey];
                  if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  } else {
                    onDateClick(day);
                  }
                }}
                aria-label={format(day, 'EEEE, MMMM d')}
              >
                <span className="week-strip-letter">{format(day, 'EEEEE')}</span>
                <span className="week-strip-num">{format(day, 'd')}</span>
                <span
                  className={cn(
                    'week-strip-dot',
                    dayTotal > 0 ? 'has-spending' : 'no-spending',
                  )}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>

        <div className="week-mobile-stats-bar">
          <span className="week-mobile-stat">
            Spent: <strong className="week-mobile-stat-spent">-{formatCompactSpending(totalWeekSpending)}</strong>
          </span>
          <span className="week-mobile-stat">
            Income: <strong className="week-mobile-stat-income">+{formatCompactSpending(totalIncome)}</strong>
          </span>
        </div>
      </div>

      {/* Desktop 7-Column Grid */}
      <div className="week-days-grid">
        {days.map((day, idx) => {
          const total = getTotalForDate(day, spendings);
          const daySpendings = getSpendingsForDate(day, spendings);
          const heatmapBg = getHeatmapColor(total, monthlyPeak, settings.theme);
          const isCurrentDay = isToday(day);

          return (
            <div
              key={idx}
              className={cn("week-day-card glass", isCurrentDay && "week-day-today")}
              style={{
                backgroundColor: heatmapBg || undefined,
                animationDelay: `${idx * 20}ms`,
              }}
              onClick={() => onDateClick(day)}
            >
              <div className="week-day-header">
                <span className="week-day-name">
                  {format(day, 'EEE')}
                </span>
                <span className="week-day-date">
                  {format(day, 'MMM d')}
                </span>
                <span className="week-day-total-desktop">
                  {total.toLocaleString('vi-VN')} ₫
                </span>
              </div>

              {/* Desktop detailed spending list */}
              <div className="week-spending-list">
                {daySpendings.length === 0 ? (
                  <div className="week-no-spending">
                    No spending on this day.
                  </div>
                ) : (
                  daySpendings.slice(0, 20).map(s => {
                    const catData = settings.categories?.find(c => c.id === s.category) || { icon: 'CircleDollarSign' };
                    return (
                      <div key={s.id} className="week-spending-item">
                        <span className="week-spending-item-label">
                          <span className="week-spending-icon">
                            <CategoryIcon iconName={catData.icon} size={14} />
                          </span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.description}</span>
                        </span>
                        <span className="week-spending-item-amount">
                          {s.amount.toLocaleString('vi-VN')} ₫
                        </span>
                      </div>
                    );
                  })
                )}
                {daySpendings.length > 20 && (
                  <div className="week-more-items">
                    + {daySpendings.length - 20} more items
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile Grouped Daily Transaction Cards */}
      <div className="week-mobile-feed hide-scrollbar">
        {days.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd');
          const daySpendings = getSpendingsForDate(day, spendings);
          const isCurrentDay = isToday(day);

          return (
            <div
              key={dayKey}
              ref={(el) => { mobileDayCardRefs.current[dayKey] = el; }}
              className={cn('week-feed-card glass', isCurrentDay && 'is-today')}
              onClick={() => onDateClick(day)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDateClick(day);
                }
              }}
            >
              <div className="week-feed-day-col">
                <span className="week-feed-day-name">{format(day, 'EEE')}</span>
                <span className="week-feed-day-num">{format(day, 'd')}</span>
              </div>

              <div className="week-feed-tx-col">
                {daySpendings.length === 0 ? (
                  <div className="week-feed-empty-row">
                    <span>No spending</span>
                    <span className="week-feed-empty-amount">0</span>
                  </div>
                ) : (
                  daySpendings.map((s) => {
                    const catData = settings.categories?.find((c) => c.id === s.category) || {
                      name: s.category,
                      icon: 'CircleDollarSign',
                      color: 'var(--primary)',
                    };
                    return (
                      <div key={s.id} className="week-feed-tx-row">
                        <span
                          className="week-feed-tx-badge"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${catData.color} 20%, transparent)`,
                            color: catData.color,
                          }}
                          aria-hidden="true"
                        >
                          <CategoryIcon iconName={catData.icon} size={15} />
                        </span>
                        <span className="week-feed-tx-desc">{s.description}</span>
                        <span className="week-feed-tx-amount">
                          -{formatCompactSpending(s.amount)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
