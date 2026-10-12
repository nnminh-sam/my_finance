import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  CalendarDays,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChevronRight,
  CircleDollarSign,
  Clock,
  ExternalLink,
  Flame,
  Info,
  Layers,
  Lightbulb,
  PiggyBank,
  Receipt,
  Search,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useFinance } from '../contexts/FinanceContext.tsx';
import { pageHref } from '../navigation';
import { computeMonthlyAnalytics, fmtCompact, fmtPct, fmtVND } from '../analytics';
import type { InsightTone } from '../analytics';
import {
  CumulativeChart,
  DailyBarChart,
  DonutChart,
  ParetoChart,
  ProgressRing,
  PunchCard,
  Sparkline,
  TrendChart,
  WeekdayChart,
} from './charts';

const FALLBACK_COLORS = ['#06b6d4', '#f43f5e', '#84cc16', '#a855f7', '#f97316', '#14b8a6', '#e11d48'];

const Card: React.FC<{
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  span?: string;
  delay?: number;
  right?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, icon, span = 'span-12', delay = 0, right, id, children }) => (
  <section id={id} className={`an-card glass ${span}`} style={{ animationDelay: `${delay}ms` }}>
    <header className="an-card-header">
      <div className="an-card-title">
        <span className="an-card-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {right}
    </header>
    {children}
  </section>
);

const Delta: React.FC<{ value: number | null; invert?: boolean; suffix?: string }> = ({ value, invert = true, suffix }) => {
  if (value === null || !isFinite(value)) return <span className="delta delta-neutral">—</span>;
  const up = value > 0;
  // For spending, "up" is bad (invert = true)
  const good = invert ? !up : up;
  return (
    <span className={`delta ${Math.abs(value) < 0.005 ? 'delta-neutral' : good ? 'delta-good' : 'delta-bad'}`}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {fmtPct(Math.abs(value), 1)}
      {suffix && <span className="delta-suffix">{suffix}</span>}
    </span>
  );
};

const LegendItem: React.FC<{ color: string; label: string; dashed?: boolean }> = ({ color, label, dashed }) => (
  <span className="legend-item">
    <span className={`legend-swatch ${dashed ? 'legend-dashed' : ''}`} style={{ background: dashed ? undefined : color, borderColor: color }} />
    {label}
  </span>
);

const toneIcon: Record<InsightTone, React.ReactNode> = {
  positive: <Sparkles size={16} />,
  warning: <AlertTriangle size={16} />,
  danger: <Flame size={16} />,
  info: <Info size={16} />,
};

export const AnalyticsView: React.FC<{ currentDate: Date }> = ({ currentDate }) => {
  const { settings } = useSettings();
  const { spendings, incomeEntries } = useFinance();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const a = useMemo(
    () => computeMonthlyAnalytics(new Date(year, month, 1), settings, spendings, incomeEntries),
    [year, month, settings, spendings, incomeEntries],
  );

  const categorySpendings = useMemo(() => {
    const map = new Map<string, typeof a.spendings>();
    for (const s of a.spendings) {
      const list = map.get(s.category);
      if (list) {
        list.push(s);
      } else {
        map.set(s.category, [s]);
      }
    }
    for (const list of map.values()) {
      list.sort((x, y) => {
        const dateCmp = y.date.localeCompare(x.date);
        if (dateCmp !== 0) return dateCmp;
        return (y.time || '').localeCompare(x.time || '');
      });
    }
    return map;
  }, [a.spendings]);

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  const allExpanded = a.categories.length > 0 && a.categories.every((c) => expandedCategories.has(c.id));
  const toggleAllCategories = () => {
    if (allExpanded) {
      setExpandedCategories(new Set());
    } else {
      setExpandedCategories(new Set(a.categories.map((c) => c.id)));
    }
  };

  const catMeta = (id: string, i: number) => {
    const c = settings.categories?.find((x) => x.id === id);
    return { name: c?.name ?? id, color: c?.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] };
  };

  const monthLabel = format(a.monthStart, 'MMMM yyyy');
  const incomeBreakdown = `Recurring base ${a.baseIncome.toLocaleString('vi-VN')} ₫ · Additional ${a.additionalIncome.toLocaleString('vi-VN')} ₫`;

  if (a.isFutureMonth || !a.hasData) {
    return (
      <div className="analytics hide-scrollbar">
        <div className="an-empty glass animate-slide-up">
          <ChartColumn size={40} />
          <h2>No spending data for {monthLabel}</h2>
          <p className="text-muted">
            {a.isFutureMonth ? 'This month hasn’t started yet.' : 'Add some expenses and your analytics will appear here.'}
          </p>
          <p className="text-muted text-sm">
            Monthly income {a.income.toLocaleString('vi-VN')} ₫ · {incomeBreakdown}
          </p>
        </div>
      </div>
    );
  }

  const partial = a.elapsedDays < a.daysInMonth;
  const segments = a.categories.map((c, i) => ({ id: c.id, label: catMeta(c.id, i).name, value: c.total, color: catMeta(c.id, i).color }));
  const hasIncome = a.income > 0;
  const incomeUse = hasIncome ? a.total / a.income : 0;
  const savingsColor = !hasIncome ? 'var(--text-muted)' : a.savingsRate >= 0.2 ? 'var(--success)' : a.savingsRate >= 0 ? 'var(--warning)' : 'var(--danger)';
  const activityTotal = Math.max(a.elapsedDays, 1);
  const activityRows = [
    { key: 'noSpend', label: 'No-spend days', value: a.activity.noSpend, color: 'var(--text-muted)' },
    { key: 'active', label: 'Active spending days', value: a.activity.active, color: 'var(--primary)' },
  ];
  const maxCatTotal = Math.max(...a.categories.map((c) => Math.max(c.total, c.prevTotal)), 1);
  const elapsedTotals = a.daily.slice(0, a.elapsedDays);

  return (
    <div className="analytics hide-scrollbar">
      {/* Hero */}
      <div className="an-hero animate-slide-up">
        <div>
          <span className="an-eyebrow">
            <Activity size={14} /> Spending analytics
          </span>
          <h2 className="an-title">{monthLabel}</h2>
          <p className="text-muted text-sm">
            {partial
              ? `Month to date · day ${a.elapsedDays} of ${a.daysInMonth} · ${a.txCount} transactions`
              : `Full month · ${a.daysInMonth} days · ${a.txCount} transactions`}
          </p>
        </div>
        <div className="an-hero-progress">
          <div className="an-hero-progress-labels">
            <span className="text-xs text-muted">Spent of income</span>
            <span className="text-xs font-semibold">{hasIncome ? fmtPct(incomeUse) : 'Income not set'}</span>
          </div>
          <div className="an-progress">
            <div
              className="an-progress-fill"
              style={{
                width: `${Math.min(incomeUse, 1) * 100}%`,
                background: incomeUse > 1 ? 'var(--danger)' : incomeUse > 0.8 ? 'var(--warning)' : undefined,
              }}
            />
            {partial && a.income > 0 && (
              <div className="an-progress-marker" style={{ left: `${Math.min(a.projectedTotal / a.income, 1) * 100}%` }} title="Projected" />
            )}
          </div>
          <span className="text-xs text-muted">
            {fmtCompact(a.total)}{hasIncome && ` / ${fmtCompact(a.income)}`}
            {partial && ` · projected ${fmtCompact(a.projectedTotal)}`}
          </span>
          <span className="text-xs text-muted">
            Monthly income {a.income.toLocaleString('vi-VN')} ₫ · {incomeBreakdown}
          </span>
        </div>
      </div>

      <div className="an-grid">
        {/* KPIs */}
        <div className="kpi glass span-3" style={{ animationDelay: '40ms' }}>
          <div className="kpi-head">
            <span className="kpi-icon" style={{ color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}>
              <Wallet size={18} />
            </span>
            <Delta value={a.momChange} suffix=" MoM" />
          </div>
          <span className="kpi-label">Total spent</span>
          <span className="kpi-value">{fmtVND(a.total)}</span>
          <div className="kpi-foot">
            <span className="text-xs text-muted">Last month same period: {fmtCompact(a.prevSamePeriodTotal)}</span>
          </div>
        </div>

        <div className="kpi glass span-3" style={{ animationDelay: '80ms' }}>
          <div className="kpi-head">
            <span className="kpi-icon" style={{ color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 14%, transparent)' }}>
              <CalendarDays size={18} />
            </span>
            <Sparkline values={elapsedTotals.map((d) => d.ma7 ?? 0)} color="var(--primary)" />
          </div>
          <span className="kpi-label">Daily average</span>
          <span className="kpi-value">{fmtVND(a.dailyMean)}</span>
          <div className="kpi-foot">
            <span className="text-xs text-muted">
              Median {fmtCompact(a.dailyMedian)} · σ {fmtCompact(a.dailyStd)}
            </span>
          </div>
        </div>

        <div className="kpi glass span-3" style={{ animationDelay: '120ms' }}>
          <div className="kpi-head">
            <span className="kpi-icon" style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }}>
              <TrendingUp size={18} />
            </span>
            {partial && <span className="chip">R² {a.r2.toFixed(2)}</span>}
          </div>
          <span className="kpi-label">{partial ? 'Projected month-end' : 'Month total'}</span>
          <span className="kpi-value">{fmtVND(a.projectedTotal)}</span>
          <div className="kpi-foot">
            <span className="text-xs text-muted">
              {partial
                ? `95% range ${fmtCompact(a.projectedLow)} – ${fmtCompact(a.projectedHigh)}`
                : hasIncome ? `Monthly income ${fmtCompact(a.income)}` : 'Monthly income not set'}
            </span>
          </div>
        </div>

        <div className="kpi glass span-3 kpi-ring" style={{ animationDelay: '160ms' }}>
          <ProgressRing value={Math.max(a.savingsRate, 0)} color={savingsColor} size={76}>
            <span style={{ fontSize: '0.95rem', fontWeight: 800, color: savingsColor }}>{hasIncome ? fmtPct(a.savingsRate) : '—'}</span>
          </ProgressRing>
          <div className="flex flex-col" style={{ gap: 2, minWidth: 0 }}>
            <span className="kpi-label">
              <PiggyBank size={14} /> {partial ? 'Projected savings rate' : 'Savings rate'}
            </span>
            <span className="kpi-value" style={{ fontSize: '1.25rem', color: savingsColor }}>
              {hasIncome ? fmtVND(a.income - a.projectedTotal) : '—'}
            </span>
            <span className="text-xs text-muted">{hasIncome ? `of ${fmtCompact(a.income)} income` : 'Monthly income not set'}</span>
          </div>
        </div>

        {/* Cumulative */}
        <Card
          span="span-8"
          delay={200}
          icon={<ChartLine size={18} />}
          title="Cumulative spending & forecast"
          subtitle="Linear regression on your running total, with a 95% prediction band"
          right={
            <div className="legend">
              <LegendItem color="var(--primary)" label="Actual" />
              {partial && <LegendItem color="var(--accent)" label="Forecast" dashed />}
              {hasIncome && <LegendItem color="var(--success)" label="Monthly income" dashed />}
            </div>
          }
        >
          <CumulativeChart
            daily={a.daily}
            elapsedDays={a.elapsedDays}
            projection={a.projection}
            income={a.income}
          />
        </Card>

        {/* Donut */}
        <Card span="span-4" delay={240} icon={<ChartPie size={18} />} title="Category breakdown" subtitle="Share of total spending">
          <div className="donut-wrap">
            <DonutChart segments={segments} total={a.total} />
            <div className="donut-legend">
              {segments.map((s) => (
                <div
                  key={s.id}
                  className="donut-legend-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setExpandedCategories((prev) => new Set(prev).add(s.id));
                    const el = document.getElementById(`cat-group-${s.id}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                  }}
                  title="Click to view details in Category performance"
                >
                  <span className="legend-swatch" style={{ background: s.color, borderColor: s.color }} />
                  <span className="truncate" style={{ flex: 1 }}>
                    {s.label}
                  </span>
                  <span className="text-muted text-xs">{fmtPct(s.value / a.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Daily */}
        <Card
          span="span-12"
          delay={280}
          icon={<ChartColumn size={18} />}
          title="Daily spending"
          subtitle="Blue intensity shows relative volume · 7-day moving average · outliers via Tukey's IQR fences"
          right={
            <div className="legend">
              <LegendItem color="var(--primary)" label="Spending volume" />
              <LegendItem color="var(--danger)" label="Statistical outlier" />
              <LegendItem color="var(--accent)" label="7-day avg" />
            </div>
          }
        >
          <DailyBarChart
            daily={a.daily}
            elapsedDays={a.elapsedDays}
            mean={a.dailyMean}
          />
        </Card>

        {/* Weekday */}
        <Card span="span-5" delay={320} icon={<CalendarDays size={18} />} title="Day-of-week pattern" subtitle="Average spend per weekday">
          <WeekdayChart data={a.weekday} />
        </Card>

        {/* Punch card */}
        <Card
          span="span-7"
          delay={360}
          icon={<Clock size={18} />}
          title="When you spend"
          subtitle={a.peakHour !== null ? `Weekday × hour heatmap · peak around ${a.peakHour}:00` : 'Weekday × hour heatmap'}
        >
          <PunchCard data={a.punchCard} />
        </Card>

        {/* Category comparison */}
        <Card
          id="category-performance-card"
          span="span-7"
          delay={400}
          icon={<Layers size={18} />}
          title="Category performance"
          subtitle={`This month vs the same ${a.elapsedDays} days last month · Click any category to inspect transactions`}
          right={
            a.categories.length > 0 && (
              <button
                type="button"
                className="cat-expand-toggle-btn"
                onClick={toggleAllCategories}
              >
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )
          }
        >
          <div className="cat-table">
            <div className="cat-row cat-row-head">
              <span>Category</span>
              <span>Spend</span>
              <span className="hide-sm">Txns</span>
              <span className="hide-sm">Avg ticket</span>
              <span style={{ textAlign: 'right' }}>MoM</span>
            </div>
            {a.categories.map((c, i) => {
              const meta = catMeta(c.id, i);
              const isExpanded = expandedCategories.has(c.id);
              const rawList = categorySpendings.get(c.id) ?? [];
              const q = (searchQueries[c.id] ?? '').trim().toLowerCase();
              const filteredList = q
                ? rawList.filter(
                    (s) =>
                      (s.description || '').toLowerCase().includes(q) ||
                      s.date.includes(q) ||
                      s.amount.toString().includes(q),
                  )
                : rawList;

              return (
                <div key={c.id} id={`cat-group-${c.id}`} className="cat-group">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    className="cat-row cat-row-interactive"
                    style={{ animationDelay: `${420 + i * 40}ms` }}
                    onClick={() => toggleCategory(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleCategory(c.id);
                      }
                    }}
                  >
                    <span className="cat-name">
                      <span className={`cat-expand-chevron ${isExpanded ? 'is-expanded' : ''}`}>
                        <ChevronRight size={14} />
                      </span>
                      <span className="legend-swatch" style={{ background: meta.color, borderColor: meta.color }} />
                      <span className="truncate">{meta.name}</span>
                    </span>
                    <span className="cat-bars">
                      <span className="cat-amount">{fmtCompact(c.total)}</span>
                      <span className="cat-bar-track">
                        <span className="cat-bar-prev" style={{ width: `${(c.prevTotal / maxCatTotal) * 100}%` }} />
                        <span className="cat-bar-fill" style={{ width: `${(c.total / maxCatTotal) * 100}%`, background: meta.color }} />
                      </span>
                    </span>
                    <span className="text-muted text-sm hide-sm">{c.count}</span>
                    <span className="text-muted text-sm hide-sm">{fmtCompact(c.avgTicket)}</span>
                    <span style={{ textAlign: 'right' }}>
                      <Delta value={c.change} />
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="cat-details-drawer">
                      <div className="cat-details-header">
                        <span className="cat-details-header-title">
                          <span>{meta.name}</span>
                          <span>·</span>
                          <span className="cat-details-header-stat">{rawList.length} transactions</span>
                          <span>·</span>
                          <span className="cat-details-header-stat">{fmtVND(c.total)}</span>
                        </span>
                        {rawList.length > 5 && (
                          <span className="text-xs text-muted">Scroll to see all</span>
                        )}
                      </div>

                      {rawList.length > 3 && (
                        <div className="cat-tx-search-wrap">
                          <Search size={13} className="text-muted" />
                          <input
                            type="text"
                            className="cat-tx-search"
                            placeholder={`Filter ${meta.name} expenses...`}
                            value={searchQueries[c.id] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSearchQueries((prev) => ({ ...prev, [c.id]: val }));
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      )}

                      {filteredList.length === 0 ? (
                        <p className="text-xs text-muted" style={{ padding: '8px 4px', margin: 0 }}>
                          No transactions match your search.
                        </p>
                      ) : (
                        <div className="cat-tx-list hide-scrollbar">
                          {filteredList.map((s) => {
                            const d = parseISO(s.date);
                            const dayUrl = pageHref('day', d);
                            const dateStr = format(d, 'dd/MM/yyyy');
                            return (
                              <a
                                key={s.id}
                                href={dayUrl}
                                className="cat-tx-item"
                                title={`View ${dateStr} day details`}
                              >
                                <div className="cat-tx-left">
                                  <span className="cat-tx-date">
                                    {dateStr}
                                    {s.time ? ` · ${s.time}` : ''}
                                  </span>
                                  <span className="cat-tx-desc" title={s.description || 'No description'}>
                                    {s.description || '(No description)'}
                                  </span>
                                </div>
                                <div className="cat-tx-right">
                                  <span className="cat-tx-amount">{fmtVND(s.amount)}</span>
                                  <ExternalLink size={12} className="cat-tx-link-icon" />
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Insights */}
        <Card span="span-5" delay={440} icon={<Lightbulb size={18} />} title="Smart insights" subtitle="Generated from your spending patterns">
          <div className="insights">
            {a.insights.map((ins, i) => (
              <div key={i} className={`insight insight-${ins.tone}`} style={{ animationDelay: `${460 + i * 60}ms` }}>
                <span className="insight-icon">{toneIcon[ins.tone]}</span>
                <div>
                  <div className="insight-title">{ins.title}</div>
                  <div className="insight-detail">{ins.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Spending activity */}
        <Card span="span-4" delay={480} icon={<Activity size={18} />} title="Spending activity" subtitle={`${a.elapsedDays} days tracked · no-spend streaks`}>
          <div className="adherence-bar">
            {activityRows.map(
              (r) =>
                r.value > 0 && (
                  <span
                    key={r.key}
                    className="adherence-seg"
                    style={{ width: `${(r.value / activityTotal) * 100}%`, background: r.color }}
                    title={`${r.label}: ${r.value}`}
                  />
                ),
            )}
          </div>
          <div className="adherence-list">
            {activityRows.map((r) => (
              <div key={r.key} className="adherence-row">
                <span className="legend-swatch" style={{ background: r.color, borderColor: r.color }} />
                <span style={{ flex: 1 }}>{r.label}</span>
                <span className="font-semibold">{r.value}</span>
                <span className="text-muted text-xs" style={{ width: 38, textAlign: 'right' }}>
                  {fmtPct(r.value / activityTotal)}
                </span>
              </div>
            ))}
          </div>
          <div className="streaks">
            <div className="streak">
              <Flame size={18} style={{ color: 'var(--warning)' }} />
              <div>
                <span className="streak-value">{a.currentNoSpendStreak}d</span>
                <span className="streak-label">Current no-spend streak</span>
              </div>
            </div>
            <div className="streak">
              <Award size={18} style={{ color: 'var(--accent)' }} />
              <div>
                <span className="streak-value">{a.longestNoSpendStreak}d</span>
                <span className="streak-label">Longest no-spend streak</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Pareto */}
        <Card
          span="span-4"
          delay={520}
          icon={<Receipt size={18} />}
          title="Spending concentration"
          subtitle="Pareto curve of transactions, largest first"
          right={<span className="chip">Gini {a.gini.toFixed(2)}</span>}
        >
          <ParetoChart points={a.pareto} pareto80={a.pareto80} />
          <div className="mini-stats">
            <div>
              <span className="mini-label">Avg ticket</span>
              <span className="mini-value">{fmtCompact(a.avgTicket)}</span>
            </div>
            <div>
              <span className="mini-label">Median ticket</span>
              <span className="mini-value">{fmtCompact(a.medianTicket)}</span>
            </div>
            <div>
              <span className="mini-label">Largest</span>
              <span className="mini-value" title={a.largest?.description}>
                {a.largest ? fmtCompact(a.largest.amount) : '—'}
              </span>
            </div>
          </div>
        </Card>

        {/* Trend */}
        <Card
          span="span-4"
          delay={560}
          icon={<CircleDollarSign size={18} />}
          title="6-month trend"
          subtitle="Monthly totals · dashed = avg of prior months"
        >
          <TrendChart data={a.trend} projected={a.projectedTotal} />
          {a.prevFullTotal > 0 && (
            <div className="mini-stats">
              <div>
                <span className="mini-label">Last month</span>
                <span className="mini-value">{fmtCompact(a.prevFullTotal)}</span>
              </div>
              <div>
                <span className="mini-label">{partial ? 'Projected' : 'This month'}</span>
                <span className="mini-value">{fmtCompact(a.projectedTotal)}</span>
              </div>
              <div>
                <span className="mini-label">Change</span>
                <span className="mini-value">
                  <Delta value={a.projectedTotal / a.prevFullTotal - 1} />
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
