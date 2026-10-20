'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, format, isToday, startOfMonth, subMonths } from 'date-fns';
import {
  Briefcase,
  CalendarClock,
  Car,
  CircleDollarSign,
  Coffee,
  Edit2,
  Film,
  Gift,
  Heart,
  Home,
  Phone,
  Receipt,
  ShoppingBag,
  Utensils,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useFinance } from '../contexts/FinanceContext';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import {
  formatCompactSpending,
  getSpendingsForDate,
  getTopSpendingsForDate,
  getTotalForDate,
} from '../lib/spendings';
import { getHeatmapColor } from '../lib/heatmap';
import { getMonthIncome } from '../lib/income';
import {
  clampDelayDays,
  clampSalaryDay,
  defaultSalaryCycleConfig,
  getSalaryCycleForMonth,
  isDateInSalaryCycle,
  loadSalaryCycleConfig,
  saveSalaryCycleConfig,
} from '../lib/salaryCycle';
import type { SalaryCycleConfig } from '../lib/salaryCycle';
import '../styles/CalendarView.css';
import '../styles/SalaryCycleView.css';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const ICONS = {
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
};

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

export interface SalaryCycleViewProps {
  currentDate: Date;
  onDateClick: (date: Date) => void;
  onNavigateDate?: (date: Date) => void;
  onEditIncome: (month?: string) => void;
}

export const SalaryCycleView: React.FC<SalaryCycleViewProps> = ({
  currentDate,
  onDateClick,
  onNavigateDate,
  onEditIncome,
}) => {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { spendings, incomeEntries, fetchWeeksSpendings } = useFinance();
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const [config, setConfig] = useState<SalaryCycleConfig>(() =>
    defaultSalaryCycleConfig(),
  );

  // Load persisted salary cycle preferences for the authenticated user
  useEffect(() => {
    setConfig(loadSalaryCycleConfig(user?.id));
  }, [user?.id]);

  const updateConfig = (updater: (prev: SalaryCycleConfig) => SalaryCycleConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      saveSalaryCycleConfig(next, user?.id);
      return next;
    });
  };

  // Compute the current salary cycle range
  const cycle = useMemo(
    () => getSalaryCycleForMonth(currentDate, config),
    [currentDate, config],
  );

  // Ensure spendings for the entire salary cycle (including overflow into next month) are fetched
  useEffect(() => {
    const firstGridDay = cycle.weeks[0]?.[0] ?? cycle.startDate;
    const lastWeek = cycle.weeks[cycle.weeks.length - 1];
    const lastGridDay = lastWeek?.[lastWeek.length - 1] ?? cycle.endDate;
    const startStr = format(firstGridDay, 'yyyy-MM-dd');
    const endStr = format(lastGridDay, 'yyyy-MM-dd');
    void fetchWeeksSpendings(startStr, endStr).catch(() => []);
  }, [cycle, fetchWeeksSpendings]);

  // Income for this salary cycle (uses the cycle's anchor month)
  const { baseIncome, additionalIncome, totalIncome } = getMonthIncome(
    settings.income,
    cycle.cycleMonth,
    incomeEntries,
  );

  // Compute cycle spending & category totals strictly across the salary cycle days
  const { categoryTotals, totalCycleSpending, cyclePeak } = useMemo(() => {
    const totals: Record<string, number> = Object.create(null);
    let peak = 0;

    for (const day of cycle.days) {
      const dayTotal = getTotalForDate(day, spendings);
      if (dayTotal > peak) peak = dayTotal;

      const daySpendings = getSpendingsForDate(day, spendings);
      for (const s of daySpendings) {
        totals[s.category] = (totals[s.category] || 0) + s.amount;
      }
    }

    const sum = Object.values(totals).reduce((acc, amount) => acc + amount, 0);
    return {
      categoryTotals: totals,
      totalCycleSpending: sum,
      cyclePeak: peak,
    };
  }, [cycle.days, spendings]);

  const topCategories = useMemo(
    () =>
      Object.entries(categoryTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [categoryTotals],
  );

  const leftOver = totalIncome - totalCycleSpending;
  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const startStr = format(cycle.startDate, 'yyyy-MM-dd');
  const endStr = format(cycle.endDate, 'yyyy-MM-dd');

  const handleSalaryDayChange = (newDay: number) => {
    const clamped = clampSalaryDay(newDay);
    updateConfig((prev) => ({
      ...prev,
      salaryDay: clamped,
    }));
  };

  const handleWeekendToggle = (checked: boolean) => {
    updateConfig((prev) => ({
      ...prev,
      shiftWeekendToMonday: checked,
    }));
  };

  const handleIncludePaydayEndToggle = (checked: boolean) => {
    updateConfig((prev) => ({
      ...prev,
      includeNextPaydayInCycle: checked,
    }));
  };

  const handleDelayStep = (delta: number) => {
    updateConfig((prev) => {
      const currentDelay = prev.monthDelays[cycle.cycleMonth] ?? 0;
      const nextDelay = clampDelayDays(currentDelay + delta);
      const nextDelays = { ...prev.monthDelays };
      if (nextDelay === 0) {
        delete nextDelays[cycle.cycleMonth];
      } else {
        nextDelays[cycle.cycleMonth] = nextDelay;
      }
      return {
        ...prev,
        monthDelays: nextDelays,
      };
    });
  };

  const handleResetDelay = () => {
    updateConfig((prev) => {
      const nextDelays = { ...prev.monthDelays };
      delete nextDelays[cycle.cycleMonth];
      return {
        ...prev,
        monthDelays: nextDelays,
      };
    });
  };

  // Touch handlers for horizontal swipe between salary cycles
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
      const baseMonth = startOfMonth(currentDate);
      if (diffX < 0) {
        onNavigateDate(addMonths(baseMonth, 1));
      } else {
        onNavigateDate(subMonths(baseMonth, 1));
      }
    }
  };

  const formatDelayLabel = (days: number) => {
    if (days === 0) return '0d';
    return days > 0 ? `+${days}d` : `${days}d`;
  };

  return (
    <div
      className="salary-cycle-container animate-fade-in"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Cycle Range & Flexible Configuration Banner */}
      <div className="salary-cycle-banner glass" role="region" aria-label="Salary cycle settings">
        <div className="salary-cycle-banner-info">
          <span className="salary-cycle-badge">
            <CalendarClock size={14} aria-hidden="true" />
            <span>Pay Cycle</span>
          </span>
          <span className="salary-cycle-dates-text">
            {format(cycle.startDate, 'MMM d, yyyy')} – {format(cycle.endDate, 'MMM d, yyyy')}
          </span>
          <span className="salary-cycle-meta-pill">
            {cycle.days.length} days
          </span>
          {cycle.weekendShiftDays > 0 && (
            <span
              className="salary-cycle-meta-pill is-shifted"
              title={`Nominal payday (${format(cycle.nominalStartDate, 'EEE, MMM d')}) fell on a weekend, shifted +${cycle.weekendShiftDays}d to Monday`}
            >
              Weekend +{cycle.weekendShiftDays}d
            </span>
          )}
          {cycle.manualDelayDays !== 0 && (
            <span
              className="salary-cycle-meta-pill is-shifted"
              title={`Adjusted by ${formatDelayLabel(cycle.manualDelayDays)} for ${format(cycle.nominalStartDate, 'MMMM yyyy')}`}
            >
              {format(cycle.nominalStartDate, 'MMM')} adjustment {formatDelayLabel(cycle.manualDelayDays)}
            </span>
          )}
        </div>

        <div className="salary-cycle-controls">
          <div className="salary-cycle-control-group">
            <label htmlFor="salary-cycle-day-select">Base payday:</label>
            <select
              id="salary-cycle-day-select"
              className="salary-cycle-select"
              value={config.salaryDay}
              onChange={(e) => handleSalaryDayChange(Number(e.target.value))}
              aria-label="Base salary day of month"
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => {
                const suffix =
                  d === 1 || d === 21
                    ? 'st'
                    : d === 2 || d === 22
                      ? 'nd'
                      : d === 3 || d === 23
                        ? 'rd'
                        : 'th';
                return (
                  <option key={d} value={d}>
                    {d}
                    {suffix} of month
                  </option>
                );
              })}
            </select>
          </div>

          <label
            className="salary-cycle-weekend-toggle"
            title="If base payday falls on Saturday or Sunday, automatically shift cycle start to Monday"
          >
            <input
              type="checkbox"
              checked={config.shiftWeekendToMonday}
              onChange={(e) => handleWeekendToggle(e.target.checked)}
            />
            <span>Weekend → Mon</span>
          </label>

          <label
            className="salary-cycle-weekend-toggle"
            title="Include the next month's payday as the final day of this salary cycle instead of the day before"
          >
            <input
              type="checkbox"
              checked={config.includeNextPaydayInCycle}
              onChange={(e) => handleIncludePaydayEndToggle(e.target.checked)}
            />
            <span>End on payday</span>
          </label>

          <div
            className="salary-cycle-control-group"
            title="Delay or advance payday for this specific month only"
          >
            <label>{format(cycle.nominalStartDate, 'MMM')} delay:</label>
            <div className="salary-cycle-delay-stepper">
              <button
                type="button"
                className="salary-cycle-step-btn"
                onClick={() => handleDelayStep(-1)}
                disabled={cycle.manualDelayDays <= -7}
                aria-label={`Decrease delay for ${format(cycle.nominalStartDate, 'MMMM yyyy')}`}
                title="Earlier by 1 day"
              >
                −
              </button>
              <span
                className={cn(
                  'salary-cycle-delay-val',
                  cycle.manualDelayDays !== 0 && 'has-delay',
                )}
              >
                {formatDelayLabel(cycle.manualDelayDays)}
              </span>
              <button
                type="button"
                className="salary-cycle-step-btn"
                onClick={() => handleDelayStep(1)}
                disabled={cycle.manualDelayDays >= 14}
                aria-label={`Increase delay for ${format(cycle.nominalStartDate, 'MMMM yyyy')}`}
                title="Delay by 1 day"
              >
                +
              </button>
              {cycle.manualDelayDays !== 0 && (
                <button
                  type="button"
                  className="salary-cycle-reset-btn"
                  onClick={handleResetDelay}
                  aria-label="Reset month delay to 0"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Overview & Top Categories Cards */}
      <div className="calendar-overview-grid">
        {/* Card 1: Cycle Overview */}
        <div className="glass animate-fade-in calendar-overview-card">
          <div className="calendar-overview-stat calendar-overview-income">
            <div className="overview-income-heading">
              <span className="calendar-stat-label">
                <span className="hide-mobile">Cycle </span>Income
              </span>
              <button
                type="button"
                className="overview-income-edit"
                onClick={() => onEditIncome(cycle.cycleMonth)}
                aria-label={`Edit additional income for ${format(cycle.nominalStartDate, 'MMMM yyyy')}`}
                aria-haspopup="dialog"
              >
                <Edit2 size={12} aria-hidden="true" />
                <span className="hide-mobile">Edit</span>
              </button>
            </div>
            <span className="calendar-stat-value calendar-stat-income-value">
              {totalIncome.toLocaleString('vi-VN')} ₫
            </span>
          </div>

          <div className="calendar-overview-stat calendar-overview-spending">
            <span className="calendar-stat-label">
              <span className="hide-mobile">Cycle </span>Spending
            </span>
            <span className="calendar-stat-value calendar-stat-spending-value">
              {totalCycleSpending.toLocaleString('vi-VN')} ₫
            </span>
          </div>

          <div className="calendar-overview-stat calendar-overview-leftover">
            <span className="calendar-stat-label">Left Over</span>
            <span
              className="calendar-stat-value"
              style={{
                color:
                  totalIncome > 0
                    ? leftOver >= 0
                      ? 'var(--primary)'
                      : 'var(--danger)'
                    : 'var(--text-muted)',
              }}
            >
              {totalIncome > 0 ? (
                `${leftOver.toLocaleString('vi-VN')} ₫`
              ) : (
                <>
                  <span className="hide-mobile">Income </span>Not set
                </>
              )}
            </span>
          </div>

          <div className="calendar-stat-subtext">
            <span className="hide-mobile">Recurring base </span>
            <span className="show-mobile">Base </span>
            {baseIncome.toLocaleString('vi-VN')} ₫ ·{' '}
            <span className="hide-mobile">Additional </span>
            <span className="show-mobile">Extra </span>
            {additionalIncome.toLocaleString('vi-VN')} ₫ ·{' '}
            <span>
              {format(cycle.startDate, 'MMM d')} – {format(cycle.endDate, 'MMM d')}
            </span>
          </div>
        </div>

        {/* Card 2: Top Categories in this Salary Cycle */}
        <div className="glass animate-fade-in calendar-top-categories-card">
          <div className="calendar-top-categories-title">
            Top 5 Categories This Salary Cycle ({format(cycle.startDate, 'MMM d')} –{' '}
            {format(cycle.endDate, 'MMM d')})
          </div>
          <div className="calendar-top-categories-list hide-scrollbar">
            {topCategories.map(([categoryId, amount]) => {
              const catData = settings.categories?.find((c) => c.id === categoryId) || {
                name: categoryId,
                icon: 'CircleDollarSign',
              };
              return (
                <div
                  key={categoryId}
                  style={{ display: 'flex', flexDirection: 'column', minWidth: '120px' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: 'var(--text-main)',
                    }}
                  >
                    <CategoryIcon iconName={catData.icon} size={14} />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {catData.name}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '1.125rem',
                      fontWeight: 700,
                      color: 'var(--text-main)',
                      marginTop: '4px',
                    }}
                  >
                    {amount.toLocaleString('vi-VN')} ₫
                  </div>
                </div>
              );
            })}
            {topCategories.length === 0 && (
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', padding: '8px 0' }}>
                No spending data for this salary cycle.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Weekdays Header */}
      <div className="calendar-weekdays-grid">
        {weekDays.map((day) => (
          <div key={day} className="calendar-weekday-label">
            {day}
          </div>
        ))}
      </div>

      {/* Cycle Calendar Weeks Grid */}
      <div
        className="calendar-days-grid hide-scrollbar"
        role="region"
        aria-label={`Salary cycle calendar from ${format(cycle.startDate, 'MMMM d, yyyy')} to ${format(cycle.endDate, 'MMMM d, yyyy')}`}
      >
        {cycle.weeks.map((weekDaysList) => {
          const weekStartStr = format(weekDaysList[0], 'yyyy-MM-dd');

          return (
            <div key={weekStartStr} className="calendar-week-row" data-week={weekStartStr}>
              {weekDaysList.map((day) => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const inCycle = isDateInSalaryCycle(day, cycle);
                const isCycleStart = dayKey === startStr;
                const isCycleEnd = dayKey === endStr;
                const isCurrentDay = isToday(day);
                const isFirstOfMonth = day.getDate() === 1;

                const total = getTotalForDate(day, spendings);
                const heatmapBg = inCycle
                  ? getHeatmapColor(total, cyclePeak, settings.theme)
                  : undefined;
                const topSpendings = getTopSpendingsForDate(day, 5, spendings);

                return (
                  <div
                    key={dayKey}
                    onClick={() => onDateClick(day)}
                    className={cn(
                      'glass calendar-day-cell',
                      inCycle ? 'salary-day-in-cycle' : 'salary-day-outside-cycle',
                      isCycleStart && 'salary-day-cycle-start',
                      isCycleEnd && 'salary-day-cycle-end',
                      isCurrentDay && 'calendar-day-today',
                      isFirstOfMonth && 'calendar-day-first-of-month',
                    )}
                    aria-current={isCurrentDay ? 'date' : undefined}
                    title={
                      isCycleStart
                        ? `Salary Cycle Start (${format(day, 'MMM d')})`
                        : isCycleEnd
                          ? `Salary Cycle End (${format(day, 'MMM d')})`
                          : !inCycle
                            ? `Outside current salary cycle (${format(day, 'MMM d')})`
                            : isCurrentDay
                              ? 'Today'
                              : undefined
                    }
                    style={{
                      backgroundColor: heatmapBg || undefined,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.filter = 'brightness(1.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.filter = '';
                    }}
                  >
                    <div className="calendar-day-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        <span
                          className={cn(
                            'calendar-day-number',
                            isCurrentDay && 'calendar-day-number-today',
                            (isFirstOfMonth || isCycleStart) && 'calendar-day-number-first',
                          )}
                        >
                          {isFirstOfMonth || isCycleStart ? (
                            <>
                              <span className="calendar-day-first-badge">{format(day, 'MMM')}</span>
                              <span>{format(day, 'd')}</span>
                            </>
                          ) : (
                            format(day, 'd')
                          )}
                        </span>
                        {isCycleStart && (
                          <span className="salary-cycle-marker-badge salary-cycle-marker-start">
                            Payday
                          </span>
                        )}
                        {isCycleEnd && (
                          <span className="salary-cycle-marker-badge salary-cycle-marker-end">
                            {config.includeNextPaydayInCycle ? 'Next Payday' : 'Cycle End'}
                          </span>
                        )}
                      </div>

                      {total > 0 && (
                        <span className="calendar-day-total-desktop">
                          {total.toLocaleString('vi-VN')} ₫
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
                          {inCycle ? 'No expenses' : 'Outside cycle'}
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
                              <CategoryIcon
                                iconName={
                                  settings.categories.find((c) => c.id === s.category)?.icon ||
                                  'CircleDollarSign'
                                }
                                size={12}
                              />
                            </span>
                            <span className="calendar-spending-description">{s.description}</span>
                          </span>
                          <span className="calendar-spending-amount">
                            {s.amount.toLocaleString('vi-VN')} ₫
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
