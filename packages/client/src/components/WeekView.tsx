import React from 'react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isToday, startOfMonth, endOfMonth } from 'date-fns';
import { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone, Edit2 } from "lucide-react";
import { getSpendingsForDate, getTotalForDate } from '../spendings';
import { useFinance } from '../contexts/FinanceContext.tsx';
import { useSettings } from '../contexts/SettingsContext';
import { getHeatmapColor } from '../heatmap';
import { getMonthIncome, incomeMonth } from '../income';

const ICONS = { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone };

const CategoryIcon = ({ iconName, size = 12 }: { iconName: string, size?: number }) => {
  const IconComp = ICONS[iconName as keyof typeof ICONS] || CircleDollarSign;
  return <IconComp size={size} />;
};

interface WeekViewProps {
  currentDate: Date;
  onDateClick: (date: Date) => void;
  onEditIncome: () => void;
}

export const WeekView: React.FC<WeekViewProps> = ({ currentDate, onDateClick, onEditIncome }) => {
  const { settings } = useSettings();
  const { spendings, incomeEntries } = useFinance();
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px', gap: '16px' }} className="animate-fade-in">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Card 1: Overview */}
        <div
          className="glass"
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
              {totalIncome.toLocaleString('vi-VN')} ₫
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Recurring base {baseIncome.toLocaleString('vi-VN')} ₫ · Additional {additionalIncome.toLocaleString('vi-VN')} ₫
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", color: "var(--text-muted)", fontWeight: 500 }}>
              Week Spending
            </span>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--danger)" }}>
              {totalWeekSpending.toLocaleString('vi-VN')} ₫
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: "0.875rem", color: "var(--text-muted)", fontWeight: 500 }}>
              Left Over (Month)
            </span>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: totalIncome > 0 ? (leftOver >= 0 ? "var(--primary)" : "var(--danger)") : "var(--text-muted)" }}>
              {totalIncome > 0 ? `${leftOver.toLocaleString('vi-VN')} ₫` : "Income not set"}
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '12px', height: '100%', overflow: 'hidden' }}>
        {days.map((day, idx) => {
          const total = getTotalForDate(day, spendings);
          const daySpendings = getSpendingsForDate(day, spendings);
          const heatmapBg = getHeatmapColor(total, monthlyPeak, settings.theme);

          return (
            <div
              key={idx}
              className="glass"
              style={{
                borderRadius: 'var(--radius-lg)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                cursor: 'pointer',
                backgroundColor: heatmapBg || undefined,
                height: '100%',
                overflowY: 'auto',
                transition: 'transform 0.2s',
                animationDelay: `${idx * 20}ms`
              }}
              onClick={() => onDateClick(day)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.01)';
                e.currentTarget.style.filter = 'brightness(1.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.filter = 'none';
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', gap: '4px' }}>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: isToday(day) ? 'var(--primary)' : 'var(--text-main)' }}>
                  {format(day, 'EEE')}
                </span>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  {format(day, 'MMM d')}
                </span>
                <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--danger)', marginTop: '4px', textAlign: 'center' }}>
                  {total.toLocaleString('vi-VN')} ₫
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {daySpendings.length === 0 ? (
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                    No spending on this day.
                  </div>
                ) : (
                  daySpendings.slice(0, 20).map(s => {
                    const catData = settings.categories?.find(c => c.id === s.category) || { icon: 'CircleDollarSign' };
                    return (
                      <div
                        key={s.id}
                        style={{
                          fontSize: "0.85rem",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          color: "var(--text-main)",
                          paddingBottom: "4px",
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
                          <span style={{ display: 'flex', color: 'var(--text-main)' }}>
                            <CategoryIcon iconName={catData.icon} size={14} />
                          </span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.description}</span>
                        </span>
                        <span
                          style={{
                            fontWeight: 800,
                          }}
                        >
                          {s.amount.toLocaleString('vi-VN')} ₫
                        </span>
                      </div>
                    );
                  })
                )}
                {daySpendings.length > 20 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, textAlign: 'center', marginTop: '4px' }}>
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
