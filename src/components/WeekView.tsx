'use client';

import React, { useRef } from 'react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, startOfMonth, endOfMonth, addWeeks, subWeeks } from 'date-fns';
import { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone, Edit2, ChevronRight } from "lucide-react";
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
  onEditIncome: () => void;
}

export const WeekView: React.FC<WeekViewProps> = ({ currentDate, onDateClick, onNavigateDate, onEditIncome }) => {
  const { settings } = useSettings();
  const { spendings, incomeEntries } = useFinance();
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

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

  return (
    <div
      className="week-container animate-fade-in"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="week-overview-grid">
        {/* Card 1: Overview */}
        <div className="week-overview-card glass">
          <div className="week-overview-stat week-overview-income">
            <div className="overview-income-heading">
              <span className="week-stat-label">Income</span>
              <button
                type="button"
                className="overview-income-edit"
                onClick={onEditIncome}
                aria-label={`Edit additional income for ${format(currentDate, 'MMMM yyyy')}`}
                aria-haspopup="dialog"
              >
                <Edit2 size={13} aria-hidden="true" />
              </button>
            </div>
            <span className="week-stat-value week-stat-income-value">
              {totalIncome.toLocaleString('vi-VN')} ₫
            </span>
          </div>

          <div className="week-overview-stat week-overview-spending">
            <span className="week-stat-label">Spending</span>
            <span className="week-stat-value week-stat-spending-value">
              {totalWeekSpending.toLocaleString('vi-VN')} ₫
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
              {totalIncome > 0 ? `${leftOver.toLocaleString('vi-VN')} ₫` : "Not set"}
            </span>
          </div>

          <div className="week-stat-subtext">
            Recurring base {baseIncome.toLocaleString('vi-VN')} ₫ · Additional {additionalIncome.toLocaleString('vi-VN')} ₫
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

              {/* Mobile compact total & chevron */}
              <div className="week-day-total-mobile">
                <span className={cn("week-day-total-val", total === 0 && "week-day-total-zero")}>
                  {total > 0 ? formatCompactSpending(total) : '0'}
                </span>
                <ChevronRight size={16} className="week-day-chevron" aria-hidden="true" />
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
    </div>
  );
};
