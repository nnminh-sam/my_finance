import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import type { DailyPoint, MonthTrendPoint, ProjectionPoint } from '../analytics';
import { fmtCompact, fmtPct, fmtVND, WEEKDAYS } from '../analytics';

/* ------------------------------------------------------------------ */
/* Shared utilities                                                    */
/* ------------------------------------------------------------------ */

const useContainerWidth = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
};

const niceScale = (maxValue: number, ticks = 4) => {
  if (maxValue <= 0) return { max: 1, step: 0.25 };
  const raw = maxValue / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: step * Math.ceil(maxValue / step), step };
};

const range = (max: number, step: number) => {
  const out: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) out.push(v);
  return out;
};

const Tooltip: React.FC<{ x: number; y: number; width: number; children: React.ReactNode }> = ({
  x,
  y,
  width,
  children,
}) => (
  <div
    className="chart-tooltip"
    style={{
      left: x,
      top: y,
      transform: `translate(${x > width * 0.6 ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
    }}
  >
    {children}
  </div>
);

const TooltipRow: React.FC<{ color: string; label: string; value: string; dashed?: boolean }> = ({
  color,
  label,
  value,
  dashed,
}) => (
  <div className="chart-tooltip-row">
    <span className="chart-tooltip-swatch" style={{ background: dashed ? 'transparent' : color, borderColor: color }} />
    <span className="chart-tooltip-label">{label}</span>
    <span className="chart-tooltip-value">{value}</span>
  </div>
);

const YAxis: React.FC<{ ticks: number[]; y: (v: number) => number; width: number; format?: (v: number) => string }> = ({
  ticks,
  y,
  width,
  format: f = fmtCompact,
}) => (
  <g>
    {ticks.map((t) => (
      <g key={t} transform={`translate(0, ${y(t)})`}>
        <line x1={0} x2={width} className="chart-grid" />
        <text x={-8} dy="0.32em" textAnchor="end" className="chart-axis-text">
          {f(t)}
        </text>
      </g>
    ))}
  </g>
);

const dayTicks = (n: number) => [1, 5, 10, 15, 20, 25, n].filter((d, i, arr) => d <= n && arr.indexOf(d) === i && !(d !== n && n - d < 3));

/* ------------------------------------------------------------------ */
/* Cumulative spending + forecast + optional monthly income           */
/* ------------------------------------------------------------------ */

export const CumulativeChart: React.FC<{
  daily: DailyPoint[];
  elapsedDays: number;
  projection: ProjectionPoint[];
  income?: number;
}> = ({ daily, elapsedDays, projection, income = 0 }) => {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  const height = 280;
  const m = { top: 16, right: 16, bottom: 28, left: 52 };
  const iw = Math.max(width - m.left - m.right, 0);
  const ih = height - m.top - m.bottom;
  const n = daily.length;

  const dataMax = Math.max(1, ...daily.map((d) => d.cumulative), ...projection.map((p) => p.high));
  const showIncome = Number.isFinite(income) && income > 0;
  const { max, step } = niceScale(showIncome ? Math.max(dataMax, income) : dataMax);
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => ih - (v / max) * ih;

  const actual = daily.slice(0, elapsedDays);
  const line = actual.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.cumulative)}`).join('');
  const area = actual.length ? `${line}L${x(actual.length - 1)},${ih}L${x(0)},${ih}Z` : '';
  const projLine = projection.map((p, i) => `${i ? 'L' : 'M'}${x(p.index)},${y(p.value)}`).join('');
  const band = projection.length
    ? `${projection.map((p, i) => `${i ? 'L' : 'M'}${x(p.index)},${y(p.high)}`).join('')}${[...projection]
        .reverse()
        .map((p) => `L${x(p.index)},${y(p.low)}`)
        .join('')}Z`
    : '';

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hp = hover !== null ? daily[hover] : null;
  const hProj = hover !== null ? projection.find((p) => p.index === hover) : undefined;
  const hoverY = hp ? y(hProj && hover! >= elapsedDays ? hProj.value : hp.cumulative) : 0;

  return (
    <div ref={ref} className="chart-wrap">
      {width > 0 && (
        <svg width={width} height={height}>
          <defs>
            <linearGradient id={`${uid}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--primary)', stopOpacity: 0.45 }} />
              <stop offset="100%" style={{ stopColor: 'var(--primary)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            <YAxis ticks={range(max, step)} y={y} width={iw} />
            {dayTicks(n).map((d) => (
              <text key={d} x={x(d - 1)} y={ih + 18} textAnchor="middle" className="chart-axis-text">
                {d}
              </text>
            ))}

            {showIncome && (
              <g>
                <line x1={0} x2={iw} y1={y(income)} y2={y(income)} className="chart-ref-line" style={{ stroke: 'var(--success)' }} />
                <text x={iw} y={y(income) - 6} textAnchor="end" className="chart-ref-label" style={{ fill: 'var(--success)' }}>
                  Income {fmtCompact(income)}
                </text>
              </g>
            )}


            {band && <path d={band} style={{ fill: 'var(--accent)', opacity: 0.14 }} />}
            {area && <path d={area} fill={`url(#${uid}-area)`} className="chart-draw-fade" />}
            {line && <path d={line} className="chart-line chart-draw" style={{ stroke: 'var(--primary)' }} />}
            {projLine && (
              <path d={projLine} className="chart-line" style={{ stroke: 'var(--accent)', strokeDasharray: '6 5' }} />
            )}
            {actual.length > 0 && (
              <circle
                cx={x(actual.length - 1)}
                cy={y(actual[actual.length - 1].cumulative)}
                r={5}
                className="chart-pulse"
                style={{ fill: 'var(--primary)' }}
              />
            )}

            {hp && (
              <g pointerEvents="none">
                <line x1={x(hover!)} x2={x(hover!)} y1={0} y2={ih} className="chart-crosshair" />
                <circle cx={x(hover!)} cy={hoverY} r={4.5} className="chart-hover-dot" />
              </g>
            )}
            <rect width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
          </g>
        </svg>
      )}
      {hp && (
        <Tooltip x={m.left + x(hover!)} y={m.top + hoverY} width={width}>
          <div className="chart-tooltip-title">{format(hp.date, 'EEE, MMM d')}</div>
          {hover! < elapsedDays && <TooltipRow color="var(--primary)" label="Spent to date" value={fmtVND(hp.cumulative)} />}
          {hProj && hover! >= elapsedDays && (
            <>
              <TooltipRow color="var(--accent)" label="Forecast" value={fmtVND(hProj.value)} dashed />
              <TooltipRow color="var(--accent)" label="95% range" value={`${fmtCompact(hProj.low)} – ${fmtCompact(hProj.high)}`} dashed />
            </>
          )}
          {showIncome && <TooltipRow color="var(--success)" label="Monthly income" value={fmtVND(income)} dashed />}
        </Tooltip>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Daily bars + 7-day moving average + anomalies                       */
/* ------------------------------------------------------------------ */

export const DailyBarChart: React.FC<{
  daily: DailyPoint[];
  elapsedDays: number;
  mean: number;
}> = ({ daily, elapsedDays, mean }) => {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  const height = 260;
  const m = { top: 20, right: 16, bottom: 28, left: 52 };
  const iw = Math.max(width - m.left - m.right, 0);
  const ih = height - m.top - m.bottom;
  const n = daily.length;
  const band = iw / n;
  const bw = Math.max(band * 0.62, 2);

  const dataMax = Math.max(1, ...daily.map((d) => d.total));
  const { max, step } = niceScale(dataMax * 1.08);
  const y = (v: number) => ih - (Math.min(v, max) / max) * ih;
  const cx = (i: number) => i * band + band / 2;

  const maLine = daily
    .slice(0, elapsedDays)
    .map((d, i) => `${i ? 'L' : 'M'}${cx(i)},${y(d.ma7 ?? 0)}`)
    .join('');

  const colorFor = (d: DailyPoint) => d.isAnomaly ? 'var(--danger)' : 'var(--primary)';
  const volumeOpacity = (d: DailyPoint) => d.isAnomaly ? 0.9 : 0.3 + 0.6 * (d.total / dataMax);

  const hp = hover !== null ? daily[hover] : null;

  return (
    <div ref={ref} className="chart-wrap">
      {width > 0 && (
        <svg width={width} height={height}>
          <defs>
            <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            <YAxis ticks={range(max, step)} y={y} width={iw} />
            {dayTicks(n).map((d) => (
              <text key={d} x={cx(d - 1)} y={ih + 18} textAnchor="middle" className="chart-axis-text">
                {d}
              </text>
            ))}

            {daily.map((d, i) => {
              const h = ih - y(d.total);
              if (d.isFuture) {
                return <rect key={i} x={cx(i) - bw / 2} y={ih - 3} width={bw} height={3} rx={1.5} className="chart-future-bar" />;
              }
              return (
                <rect
                  key={i}
                  x={cx(i) - bw / 2}
                  y={y(d.total)}
                  width={bw}
                  height={Math.max(h, d.total > 0 ? 2 : 0)}
                  rx={Math.min(bw / 2, 4)}
                  className="chart-bar"
                  style={{
                    fill: colorFor(d),
                    opacity: volumeOpacity(d) * (hover === null || hover === i ? 1 : 0.4),
                    animationDelay: `${i * 18}ms`,
                  }}
                  filter={d.isAnomaly ? `url(#${uid}-glow)` : undefined}
                />
              );
            })}

            {mean > 0 && mean <= max && (
              <g>
                <line x1={0} x2={iw} y1={y(mean)} y2={y(mean)} className="chart-ref-line" style={{ stroke: 'var(--text-muted)' }} />
                <text x={iw} y={y(mean) - 5} textAnchor="end" className="chart-ref-label" style={{ fill: 'var(--text-muted)' }}>
                  Avg
                </text>
              </g>
            )}

            {maLine && <path d={maLine} className="chart-line chart-draw" style={{ stroke: 'var(--accent)', strokeWidth: 2.5 }} />}

            {daily
              .filter((d) => d.isAnomaly)
              .map((d) => (
                <g key={`a-${d.day}`} transform={`translate(${cx(d.day - 1)}, ${Math.max(y(d.total) - 12, 6)})`}>
                  <circle r={7} style={{ fill: 'var(--danger)' }} className="chart-pulse" />
                  <text textAnchor="middle" dy="0.35em" className="chart-anomaly-text">
                    !
                  </text>
                </g>
              ))}

            {daily.map((_, i) => (
              <rect
                key={`h-${i}`}
                x={i * band}
                y={0}
                width={band}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
      )}
      {hp && !hp.isFuture && (
        <Tooltip x={m.left + cx(hover!)} y={m.top + y(hp.total)} width={width}>
          <div className="chart-tooltip-title">{format(hp.date, 'EEE, MMM d')}</div>
          <TooltipRow color={colorFor(hp)} label={`${hp.count} txn${hp.count === 1 ? '' : 's'}`} value={fmtVND(hp.total)} />
          <TooltipRow color="var(--accent)" label="7-day avg" value={fmtVND(hp.ma7 ?? 0)} />
          <TooltipRow color="var(--text-muted)" label="z-score" value={`${hp.zScore >= 0 ? '+' : ''}${hp.zScore.toFixed(2)}σ`} dashed />
          {hp.isAnomaly && <div className="chart-tooltip-flag">⚠ Statistical outlier</div>}
        </Tooltip>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Donut chart                                                         */
/* ------------------------------------------------------------------ */

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

export const DonutChart: React.FC<{ segments: DonutSegment[]; total: number; size?: number }> = ({
  segments,
  total,
  size = 220,
}) => {
  const [active, setActive] = useState<string | null>(null);
  const stroke = 26;
  const r = (size - stroke) / 2 - 6;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const act = segments.find((s) => s.id === active);

  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: 'var(--bg-card-hover)' }} />
          {segments.map((s, i) => {
            const len = total ? (s.value / total) * C : 0;
            const gap = len > 6 ? 3 : 0;
            const el = (
              <circle
                key={s.id}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={active === s.id ? stroke + 8 : stroke}
                strokeDasharray={`${Math.max(len - gap, 0)} ${C}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                className="donut-seg"
                style={{
                  opacity: active && active !== s.id ? 0.3 : 1,
                  animationDelay: `${i * 80}ms`,
                }}
                onMouseEnter={() => setActive(s.id)}
                onMouseLeave={() => setActive(null)}
              />
            );
            offset += len;
            return el;
          })}
        </g>
      </svg>
      <div className="donut-center">
        <span className="donut-center-label">{act ? act.label : 'Total spent'}</span>
        <span className="donut-center-value">{fmtCompact(act ? act.value : total)}</span>
        {act && <span className="donut-center-sub">{fmtPct(total ? act.value / total : 0, 1)}</span>}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Weekday averages                                                    */
/* ------------------------------------------------------------------ */

export const WeekdayChart: React.FC<{ data: { avg: number; days: number }[] }> = ({ data }) => {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  const height = 220;
  const m = { top: 24, right: 8, bottom: 26, left: 8 };
  const iw = Math.max(width - m.left - m.right, 0);
  const ih = height - m.top - m.bottom;
  const band = iw / 7;
  const bw = Math.min(band * 0.6, 44);
  const maxV = Math.max(1, ...data.map((d) => d.avg));
  const peak = data.findIndex((d) => d.avg === maxV);
  const withDays = data.filter((d) => d.days > 0);
  const avgAll = withDays.length ? withDays.reduce((s, d) => s + d.avg, 0) / withDays.length : 0;
  const y = (v: number) => ih - (v / (maxV * 1.1)) * ih;

  return (
    <div ref={ref} className="chart-wrap">
      {width > 0 && (
        <svg width={width} height={height}>
          <defs>
            <linearGradient id={`${uid}-bar`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--primary)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--primary)', stopOpacity: 0.25 }} />
            </linearGradient>
            <linearGradient id={`${uid}-peak`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--accent)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.3 }} />
            </linearGradient>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            {data.map((d, i) => {
              const x = i * band + (band - bw) / 2;
              const isPeak = i === peak && d.avg > 0;
              return (
                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={i * band} y={0} width={band} height={ih} fill="transparent" />
                  <rect
                    x={x}
                    y={y(d.avg)}
                    width={bw}
                    height={ih - y(d.avg)}
                    rx={6}
                    fill={`url(#${uid}-${isPeak ? 'peak' : 'bar'})`}
                    className="chart-bar"
                    style={{ opacity: hover === null || hover === i ? 1 : 0.4, animationDelay: `${i * 50}ms` }}
                  />
                  {(hover === i || isPeak) && (
                    <text x={x + bw / 2} y={y(d.avg) - 8} textAnchor="middle" className="chart-value-text">
                      {fmtCompact(d.avg)}
                    </text>
                  )}
                  <text
                    x={x + bw / 2}
                    y={ih + 18}
                    textAnchor="middle"
                    className="chart-axis-text"
                    style={{ fontWeight: isPeak ? 700 : 500, fill: isPeak ? 'var(--text-main)' : undefined }}
                  >
                    {WEEKDAYS[i]}
                  </text>
                </g>
              );
            })}
            {avgAll > 0 && (
              <line x1={0} x2={iw} y1={y(avgAll)} y2={y(avgAll)} className="chart-ref-line" style={{ stroke: 'var(--text-muted)' }} />
            )}
          </g>
        </svg>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Weekday × hour punch-card heatmap                                   */
/* ------------------------------------------------------------------ */

export const PunchCard: React.FC<{ data: { amount: number; count: number }[][] }> = ({ data }) => {
  const [hover, setHover] = useState<{ w: number; h: number } | null>(null);
  const maxV = Math.max(1, ...data.flat().map((c) => c.amount));
  // Show a stable 6:00–23:00 window, widened if any activity falls outside it
  const active = Array.from({ length: 24 }, (_, h) => data.some((row) => row[h].count > 0));
  const firstActive = active.indexOf(true);
  const lastActive = 23 - [...active].reverse().indexOf(true);
  const first = firstActive === -1 ? 6 : Math.min(6, firstActive);
  const end = firstActive === -1 ? 23 : Math.max(23, lastActive);
  const hours = Array.from({ length: end - first + 1 }, (_, i) => first + i);
  const cell = hover ? data[hover.w][hover.h] : null;

  return (
    <div className="punch">
      <div className="punch-grid" style={{ gridTemplateColumns: `36px repeat(${hours.length}, minmax(0, 1fr))` }}>
        {data.map((row, w) => (
          <React.Fragment key={w}>
            <span className="punch-row-label">{WEEKDAYS[w]}</span>
            {hours.map((h) => {
              const c = row[h];
              const intensity = c.amount / maxV;
              return (
                <div
                  key={h}
                  className="punch-cell"
                  onMouseEnter={() => setHover({ w, h })}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    background:
                      c.count > 0
                        ? `color-mix(in srgb, var(--primary) ${Math.round(20 + intensity * 80)}%, transparent)`
                        : undefined,
                    boxShadow: intensity > 0.7 ? '0 0 10px var(--primary-glow)' : undefined,
                    outline: hover && hover.w === w && hover.h === h ? '2px solid var(--text-main)' : undefined,
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}
        <span />
        {hours.map((h) => (
          <span key={h} className="punch-col-label">
            {h % 3 === 0 ? `${h}h` : ''}
          </span>
        ))}
      </div>
      <div className="punch-footer">
        <span className="text-muted text-xs">
          {hover && cell
            ? `${WEEKDAYS[hover.w]} ${String(hover.h).padStart(2, '0')}:00–${String(hover.h + 1).padStart(2, '0')}:00 · ${cell.count} txn${
                cell.count === 1 ? '' : 's'
              } · ${fmtVND(cell.amount)}`
            : 'Hover a cell to see details'}
        </span>
        <span className="punch-legend">
          <span className="text-xs text-muted">Less</span>
          {[0.2, 0.4, 0.6, 0.8, 1].map((v) => (
            <span
              key={v}
              className="punch-legend-cell"
              style={{ background: `color-mix(in srgb, var(--primary) ${Math.round(20 + v * 80)}%, transparent)` }}
            />
          ))}
          <span className="text-xs text-muted">More</span>
        </span>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Pareto / Lorenz-style concentration curve                           */
/* ------------------------------------------------------------------ */

export const ParetoChart: React.FC<{ points: { x: number; y: number }[]; pareto80: number }> = ({ points, pareto80 }) => {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const uid = useId();
  const height = 200;
  const m = { top: 12, right: 12, bottom: 24, left: 36 };
  const iw = Math.max(width - m.left - m.right, 0);
  const ih = height - m.top - m.bottom;
  const x = (v: number) => v * iw;
  const y = (v: number) => ih - v * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join('');
  const area = `${line}L${x(1)},${y(1)}L${x(0)},${y(0)}Z`;

  return (
    <div ref={ref} className="chart-wrap">
      {width > 0 && points.length > 1 && (
        <svg width={width} height={height}>
          <defs>
            <linearGradient id={`${uid}-p`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.35 }} />
              <stop offset="100%" style={{ stopColor: 'var(--primary)', stopOpacity: 0.08 }} />
            </linearGradient>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={-6} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis-text">
                  {fmtPct(t)}
                </text>
                <text x={x(t)} y={ih + 16} textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'} className="chart-axis-text">
                  {fmtPct(t)}
                </text>
              </g>
            ))}
            <path d={area} fill={`url(#${uid}-p)`} className="chart-draw-fade" />
            <line x1={0} y1={ih} x2={iw} y2={0} className="chart-ref-line" style={{ stroke: 'var(--text-muted)' }} />
            <path d={line} className="chart-line chart-draw" style={{ stroke: 'var(--accent)' }} />
            {pareto80 > 0 && (
              <g>
                <line x1={x(pareto80)} x2={x(pareto80)} y1={y(0.8)} y2={ih} className="chart-ref-line" style={{ stroke: 'var(--warning)' }} />
                <line x1={0} x2={x(pareto80)} y1={y(0.8)} y2={y(0.8)} className="chart-ref-line" style={{ stroke: 'var(--warning)' }} />
                <circle cx={x(pareto80)} cy={y(0.8)} r={5} style={{ fill: 'var(--warning)' }} className="chart-pulse" />
                <text x={x(pareto80) + 8} y={y(0.8) + 16} className="chart-ref-label" style={{ fill: 'var(--warning)' }}>
                  {fmtPct(pareto80)} → 80%
                </text>
              </g>
            )}
          </g>
        </svg>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 6-month trend                                                       */
/* ------------------------------------------------------------------ */

export const TrendChart: React.FC<{ data: MonthTrendPoint[]; projected: number }> = ({ data, projected }) => {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  const height = 200;
  const m = { top: 22, right: 8, bottom: 24, left: 8 };
  const iw = Math.max(width - m.left - m.right, 0);
  const ih = height - m.top - m.bottom;
  const band = iw / data.length;
  const bw = Math.min(band * 0.56, 40);
  const current = data[data.length - 1];
  const maxV = Math.max(1, ...data.map((d) => d.total), current?.isPartial ? projected : 0);
  const y = (v: number) => ih - (v / (maxV * 1.12)) * ih;
  const prior = data.slice(0, -1).filter((d) => d.total > 0);
  const avgPrior = prior.length ? prior.reduce((s, d) => s + d.total, 0) / prior.length : 0;

  return (
    <div ref={ref} className="chart-wrap">
      {width > 0 && (
        <svg width={width} height={height}>
          <defs>
            <linearGradient id={`${uid}-t`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--text-muted)', stopOpacity: 0.7 }} />
              <stop offset="100%" style={{ stopColor: 'var(--text-muted)', stopOpacity: 0.2 }} />
            </linearGradient>
            <linearGradient id={`${uid}-c`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--primary)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.6 }} />
            </linearGradient>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            {data.map((d, i) => {
              const x = i * band + (band - bw) / 2;
              return (
                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={i * band} y={0} width={band} height={ih} fill="transparent" />
                  {d.isPartial && projected > d.total && (
                    <rect
                      x={x}
                      y={y(projected)}
                      width={bw}
                      height={ih - y(projected)}
                      rx={6}
                      className="chart-ghost-bar"
                    />
                  )}
                  <rect
                    x={x}
                    y={y(d.total)}
                    width={bw}
                    height={ih - y(d.total)}
                    rx={6}
                    fill={`url(#${uid}-${d.isCurrent ? 'c' : 't'})`}
                    className="chart-bar"
                    style={{ animationDelay: `${i * 60}ms`, opacity: hover === null || hover === i ? 1 : 0.5 }}
                  />
                  {(hover === i || d.isCurrent) && (
                    <text
                      x={x + bw / 2}
                      y={y(d.isPartial ? Math.max(projected, d.total) : d.total) - 7}
                      textAnchor="middle"
                      className="chart-value-text"
                    >
                      {fmtCompact(d.total)}
                      {d.isPartial && hover === i ? ` → ${fmtCompact(projected)}` : ''}
                    </text>
                  )}
                  <text
                    x={x + bw / 2}
                    y={ih + 17}
                    textAnchor="middle"
                    className="chart-axis-text"
                    style={{ fontWeight: d.isCurrent ? 700 : 500, fill: d.isCurrent ? 'var(--text-main)' : undefined }}
                  >
                    {d.label}
                  </text>
                </g>
              );
            })}
            {avgPrior > 0 && (
              <g>
                <line x1={0} x2={iw} y1={y(avgPrior)} y2={y(avgPrior)} className="chart-ref-line" style={{ stroke: 'var(--warning)' }} />
              </g>
            )}
          </g>
        </svg>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export const ProgressRing: React.FC<{ value: number; size?: number; color: string; children?: React.ReactNode }> = ({
  value,
  size = 64,
  color,
  children,
}) => {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: 'var(--bg-card-hover)' }} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ring-progress"
          style={{ stroke: color }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
};

export const Sparkline: React.FC<{ values: number[]; color: string; width?: number; height?: number }> = ({
  values,
  color,
  width = 96,
  height = 32,
}) => {
  const uid = useId();
  if (values.length < 2) return null;
  const maxV = Math.max(...values, 1);
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 2 - (v / maxV) * (height - 4);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  return (
    <svg width={width} height={height} className="sparkline">
      <defs>
        <linearGradient id={`${uid}-s`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={`${line}L${width},${height}L0,${height}Z`} fill={`url(#${uid}-s)`} />
      <path d={line} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: color }} />
    </svg>
  );
};
