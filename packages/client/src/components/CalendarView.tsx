import React from "react";
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  isSameMonth,
  isToday,
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
import { getTotalForDate, getTopSpendingsForDate, getSpendingsForDate } from "../spendings";
import { useFinance } from "../contexts/FinanceContext.tsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useSettings } from "../contexts/SettingsContext";
import { getHeatmapColor } from "../heatmap";
import { getMonthIncome, incomeMonth } from "../income";
import "./CalendarView.css";

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
  onDateClick: (date: Date) => void;
  onEditIncome: () => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  currentDate,
  onDateClick,
  onEditIncome,
}) => {
  const { settings } = useSettings();
  const { spendings, incomeEntries } = useFinance();
  const { baseIncome, additionalIncome, totalIncome } = getMonthIncome(
    settings.income, incomeMonth(currentDate), incomeEntries,
  );
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  // Share the selected month's peak with WeekView, including cross-month cells.
  const monthlyPeak = Math.max(0, ...monthDays.map(day => getTotalForDate(day, spendings)));

  const categoryTotals: Record<string, number> = Object.create(null);
  monthDays.forEach(day => {
    getSpendingsForDate(day, spendings).forEach(s => {
      categoryTotals[s.category] = (categoryTotals[s.category] || 0) + s.amount;
    });
  });

  const totalSpending = Object.values(categoryTotals).reduce((sum, amount) => sum + amount, 0);
  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const leftOver = totalIncome - totalSpending;

  return (
    <div className="calendar-container">
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
                onClick={onEditIncome}
                aria-label={`Edit additional income for ${format(currentDate, 'MMMM yyyy')}`}
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

      <div className="calendar-days-grid hide-scrollbar">
        {days.map((day, idx) => {
          const total = getTotalForDate(day, spendings);
          const topSpendings = getTopSpendingsForDate(day, 5, spendings);
          const heatmapBg = getHeatmapColor(
            total,
            monthlyPeak,
            settings.theme,
          );
          const isCurrentDay = isToday(day);

          return (
            <div
              key={idx}
              onClick={() => onDateClick(day)}
              className={cn(
                "glass animate-fade-in calendar-day-cell",
                isCurrentDay && "calendar-day-today",
              )}
              aria-current={isCurrentDay ? "date" : undefined}
              title={isCurrentDay ? "Today" : undefined}
              style={{
                backgroundColor: heatmapBg || undefined,
                animationDelay: `${idx * 15}ms`,
                filter: !isSameMonth(day, monthStart)
                  ? "grayscale(100%) opacity(0.3)"
                  : undefined,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.filter = !isSameMonth(day, monthStart)
                  ? "grayscale(100%) opacity(0.4) brightness(1.3)"
                  : "brightness(1.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.filter = !isSameMonth(day, monthStart)
                  ? "grayscale(100%) opacity(0.3)"
                  : "none";
              }}
            >
              <div className="calendar-day-header">
                <span
                  className={cn("calendar-day-number", isCurrentDay && "calendar-day-number-today")}
                >
                  {format(day, "d")}
                </span>
                {total > 0 && (
                  <span className="calendar-day-total-desktop">
                    {total.toLocaleString("vi-VN")} ₫
                  </span>
                )}
              </div>

              {total > 0 && (
                <div className="calendar-day-total-mobile">
                  {total.toLocaleString("vi-VN")} ₫
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
    </div>
  );
};
