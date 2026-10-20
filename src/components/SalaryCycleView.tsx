'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import {
  Briefcase,
  Calendar,
  CalendarClock,
  Car,
  ChevronDown,
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

function ordinalDay(d: number): string {
  const suffix =
    d === 1 || d === 21
      ? 'st'
      : d === 2 || d === 22
        ? 'nd'
        : d === 3 || d === 23
          ? 'rd'
          : 'th';
  return `${d}${suffix}`;
}

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
  const [openPopover, setOpenPopover] = useState<'baseDay' | 'monthDate' | null>(null);
  const baseDayPopoverRef = useRef<HTMLDivElement>(null);
  const monthDatePopoverRef = useRef<HTMLDivElement>(null);

  // Load persisted salary cycle preferences for the authenticated user
  useEffect(() => {
    setConfig(loadSalaryCycleConfig(user?.id));
  }, [user?.id]);

  // Close popovers on outside click or Escape key
  useEffect(() => {
    if (!openPopover) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        openPopover === 'baseDay' &&
        baseDayPopoverRef.current &&
        !baseDayPopoverRef.current.contains(target)
      ) {
        setOpenPopover(null);
      } else if (
        openPopover === 'monthDate' &&
        monthDatePopoverRef.current &&
        !monthDatePopoverRef.current.contains(target)
      ) {
        setOpenPopover(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopover(null);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openPopover]);

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
    setOpenPopover(null);
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

  const setMonthManualDelay = (newDelay: number) => {
    const clamped = clampDelayDays(newDelay);
    updateConfig((prev) => {
      const nextDelays = { ...prev.monthDelays };
      if (clamped === 0) {
        delete nextDelays[cycle.cycleMonth];
      } else {
        nextDelays[cycle.cycleMonth] = clamped;
      }
      return {
        ...prev,
        monthDelays: nextDelays,
      };
    });
  };

  const handleDelayStep = (delta: number) => {
    const currentDelay = config.monthDelays[cycle.cycleMonth] ?? 0;
    setMonthManualDelay(currentDelay + delta);
  };

  const handleResetDelay = () => {
    setMonthManualDelay(0);
  };

  // Mini calendar days for picking the exact payday date for the active month
  const miniMonthCalendarDays = useMemo(() => {
    const mStart = startOfMonth(cycle.nominalStartDate);
    const mEnd = endOfMonth(mStart);
    return eachDayOfInterval({
      start: startOfWeek(mStart, { weekStartsOn: 1 }),
      end: endOfWeek(mEnd, { weekStartsOn: 1 }),
    });
  }, [cycle.nominalStartDate]);

  // Default payday for this month (nominal + weekend shift, before manual delay)
  const defaultMonthPayday = useMemo(
    () => addDays(cycle.nominalStartDate, cycle.weekendShiftDays),
    [cycle.nominalStartDate, cycle.weekendShiftDays],
  );

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

  const presetDays = [1, 5, 10, 15, 20, 25];

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
          {/* Custom Popover 1: Base Payday Grid Picker (1st - 28th) */}
          <div className="salary-picker-anchor" ref={baseDayPopoverRef}>
            <button
              type="button"
              className={cn(
                'salary-picker-trigger',
                openPopover === 'baseDay' && 'is-open',
              )}
              aria-expanded={openPopover === 'baseDay'}
              aria-haspopup="dialog"
              onClick={() =>
                setOpenPopover((prev) => (prev === 'baseDay' ? null : 'baseDay'))
              }
            >
              <Calendar size={14} aria-hidden="true" style={{ color: 'var(--primary)' }} />
              <span className="salary-picker-trigger-label">Payday:</span>
              <span className="salary-picker-trigger-value">
                {ordinalDay(config.salaryDay)} of month
              </span>
              <ChevronDown size={14} className="salary-picker-trigger-chevron" aria-hidden="true" />
            </button>

            {openPopover === 'baseDay' && (
              <div
                className="salary-picker-popover salary-picker-popover-left"
                role="dialog"
                aria-label="Choose recurring base payday of month"
              >
                <div className="salary-picker-header">
                  <div>
                    <div className="salary-picker-title">Monthly Base Payday</div>
                    <div className="salary-picker-subtitle">
                      Select the recurring day of the month your salary is normally paid (1st–28th).
                    </div>
                  </div>
                </div>

                <div className="salary-picker-presets">
                  {presetDays.map((pDay) => (
                    <button
                      key={pDay}
                      type="button"
                      className={cn(
                        'salary-picker-preset-chip',
                        config.salaryDay === pDay && 'is-active',
                      )}
                      onClick={() => handleSalaryDayChange(pDay)}
                    >
                      {ordinalDay(pDay)}
                    </button>
                  ))}
                </div>

                <div className="salary-day-grid">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={cn(
                        'salary-day-grid-btn',
                        config.salaryDay === d && 'is-selected',
                      )}
                      onClick={() => handleSalaryDayChange(d)}
                      aria-label={`${ordinalDay(d)} of every month`}
                      aria-pressed={config.salaryDay === d}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                <div className="salary-picker-footer">
                  <span>Currently: Every {ordinalDay(config.salaryDay)}</span>
                  <button
                    type="button"
                    className="salary-cycle-reset-btn"
                    onClick={() => handleSalaryDayChange(5)}
                  >
                    Default (5th)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Custom Popover 2: Month-Specific Actual Payday Calendar Picker & Delay Stepper */}
          <div className="salary-picker-anchor" ref={monthDatePopoverRef}>
            <button
              type="button"
              className={cn(
                'salary-picker-trigger',
                openPopover === 'monthDate' && 'is-open',
              )}
              aria-expanded={openPopover === 'monthDate'}
              aria-haspopup="dialog"
              onClick={() =>
                setOpenPopover((prev) => (prev === 'monthDate' ? null : 'monthDate'))
              }
              title="Click to pick exact payday date or adjust delay for this month only"
            >
              <span className="salary-picker-trigger-label">
                {format(cycle.nominalStartDate, 'MMM')} start:
              </span>
              <span
                className={cn(
                  'salary-picker-trigger-value',
                  cycle.manualDelayDays !== 0 && 'has-delay',
                )}
                style={
                  cycle.manualDelayDays !== 0 ? { color: 'var(--warning)' } : undefined
                }
              >
                {format(cycle.startDate, 'MMM d')}
                {cycle.manualDelayDays !== 0 &&
                  ` (${formatDelayLabel(cycle.manualDelayDays)})`}
              </span>
              <ChevronDown size={14} className="salary-picker-trigger-chevron" aria-hidden="true" />
            </button>

            {openPopover === 'monthDate' && (
              <div
                className="salary-picker-popover"
                role="dialog"
                aria-label={`Adjust payday for ${format(cycle.nominalStartDate, 'MMMM yyyy')}`}
              >
                <div className="salary-picker-header">
                  <div>
                    <div className="salary-picker-title">
                      {format(cycle.nominalStartDate, 'MMMM yyyy')} Payday
                    </div>
                    <div className="salary-picker-subtitle">
                      Pick the exact date you received salary in{' '}
                      {format(cycle.nominalStartDate, 'MMMM')} (only affects this month).
                    </div>
                  </div>
                </div>

                <div className="salary-day-grid">
                  {weekDays.map((w) => (
                    <div key={w} className="salary-day-grid-weekday">
                      {w.slice(0, 2)}
                    </div>
                  ))}
                  {miniMonthCalendarDays.map((d) => {
                    const diffFromDefault = differenceInCalendarDays(
                      d,
                      defaultMonthPayday,
                    );
                    const allowed = diffFromDefault >= -7 && diffFromDefault <= 14;
                    const isSelected =
                      format(d, 'yyyy-MM-dd') === format(cycle.startDate, 'yyyy-MM-dd');
                    const isDefault =
                      format(d, 'yyyy-MM-dd') ===
                      format(defaultMonthPayday, 'yyyy-MM-dd');
                    const inNominalMonth = isSameMonth(d, cycle.nominalStartDate);

                    return (
                      <button
                        key={format(d, 'yyyy-MM-dd')}
                        type="button"
                        disabled={!allowed}
                        className={cn(
                          'salary-day-grid-btn',
                          isSelected && 'is-selected',
                          !isSelected && isDefault && 'is-nominal',
                        )}
                        style={
                          !allowed
                            ? { opacity: 0.22, cursor: 'not-allowed' }
                            : !inNominalMonth && !isSelected
                              ? { opacity: 0.55 }
                              : undefined
                        }
                        onClick={() => {
                          setMonthManualDelay(diffFromDefault);
                          setOpenPopover(null);
                        }}
                        title={
                          allowed
                            ? `${format(d, 'EEE, MMM d, yyyy')} (${formatDelayLabel(diffFromDefault)} from scheduled payday)`
                            : `${format(d, 'MMM d')} is outside the -7d to +14d adjustment window`
                        }
                      >
                        {format(d, 'd')}
                      </button>
                    );
                  })}
                </div>

                <div className="salary-picker-footer">
                  <div className="salary-cycle-delay-stepper">
                    <span>Shift:</span>
                    <button
                      type="button"
                      className="salary-cycle-step-btn"
                      onClick={() => handleDelayStep(-1)}
                      disabled={cycle.manualDelayDays <= -7}
                      aria-label="Earlier by 1 day"
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
                      aria-label="Later by 1 day"
                    >
                      +
                    </button>
                  </div>
                  {cycle.manualDelayDays !== 0 ? (
                    <button
                      type="button"
                      className="salary-cycle-reset-btn"
                      onClick={handleResetDelay}
                    >
                      Reset to {format(defaultMonthPayday, 'MMM d')}
                    </button>
                  ) : (
                    <span>On schedule</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <label
            className="salary-cycle-weekend-toggle"
            title="When your base payday falls on a Saturday or Sunday, automatically shift the cycle start to the following Monday"
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
