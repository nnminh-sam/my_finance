import React from "react";
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  isSameMonth,

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "16px",
        gap: "16px",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Card 1: Overview */}
        <div
          className="glass animate-fade-in"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 24px",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div className="overview-income-heading">
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)", fontWeight: 500 }}>Monthly Income</span>
              <button type="button" className="overview-income-edit" onClick={onEditIncome} aria-label={`Edit additional income for ${format(currentDate, 'MMMM yyyy')}`} aria-haspopup="dialog">
                <Edit2 size={14} aria-hidden="true" />Edit
              </button>
            </div>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--success)" }}>
              {totalIncome.toLocaleString("vi-VN")} ₫
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Recurring base {baseIncome.toLocaleString("vi-VN")} ₫ · Additional {additionalIncome.toLocaleString("vi-VN")} ₫
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", color: "var(--text-muted)", fontWeight: 500 }}>
              Total Spending
            </span>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--danger)" }}>
              {totalSpending.toLocaleString("vi-VN")} ₫
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: "0.875rem", color: "var(--text-muted)", fontWeight: 500 }}>
              Left Over
            </span>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: totalIncome > 0 ? (leftOver >= 0 ? "var(--primary)" : "var(--danger)") : "var(--text-muted)" }}>
              {totalIncome > 0 ? `${leftOver.toLocaleString("vi-VN")} ₫` : "Income not set"}
            </span>
          </div>
        </div>

        {/* Card 2: Top Categories */}
        <div
          className="glass animate-fade-in"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "12px 24px",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", fontWeight: 600, marginBottom: "8px" }}>
            Top 5 Categories This Month
          </div>
          <div style={{ display: "flex", gap: "16px", flexWrap: "nowrap", overflowX: "auto" }} className="hide-scrollbar">
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: "8px",
          textAlign: "center",
        }}
      >
        {weekDays.map((day) => (
          <div
            key={day}
            style={{
              fontWeight: 600,
              fontSize: "0.875rem",
              color: "var(--text-muted)",
            }}
          >
            {day}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: "8px",
          flex: 1,
          overflowY: "auto",
        }}
        className="hide-scrollbar"
      >
        {days.map((day, idx) => {
          const total = getTotalForDate(day, spendings);
          const topSpendings = getTopSpendingsForDate(day, 5, spendings);
          const heatmapBg = getHeatmapColor(
            total,
            monthlyPeak,
            settings.theme,
          );

          return (
            <div
              key={idx}
              onClick={() => onDateClick(day)}
              className={cn("glass animate-fade-in")}
              style={{
                borderRadius: "var(--radius-md)",
                padding: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                cursor: "pointer",
                minHeight: "110px",
                backgroundColor: heatmapBg || undefined,
                transition: "all 0.2s",
                animationDelay: `${idx * 15}ms`,
                color: "var(--text-main)", // Force text color for better contrast against heatmap
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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "4px",
                }}
              >
                <span
                  style={{
                    width: "28px",
                    height: "28px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "50%",
                    backgroundColor: "transparent",
                    color: "var(--text-main)",
                    fontSize: "1.25rem",
                    fontWeight: 900,
                  }}
                >
                  {format(day, "d")}
                </span>
                {total > 0 && (
                  <span
                    style={{
                      fontSize: "1.125rem",
                      fontWeight: 900,
                      color: "var(--text-main)",
                      backgroundColor: "transparent",
                      padding: "0",
                      borderRadius: "0",
                      boxShadow: "none",
                    }}
                  >
                    {total.toLocaleString("vi-VN")} ₫
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  flex: 1,
                }}
              >
                {topSpendings.length === 0 && (
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    No expenses
                  </span>
                )}
                {topSpendings.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      fontSize: "0.85rem",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "var(--text-main)",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "70%",
                        fontWeight: 700,
                      }}
                    >
                      <span
                        style={{ display: "flex", color: "var(--text-main)" }}
                      >
                        <CategoryIcon iconName={settings.categories.find(c => c.id === s.category)?.icon || "CircleDollarSign"} size={14} />
                      </span>
                      <span
                        style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {s.description}
                      </span>
                    </span>
                    <span
                      style={{
                        fontWeight: 800,
                      }}
                    >
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
