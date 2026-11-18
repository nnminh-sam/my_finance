'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { Spending } from '../types';
import {
  dayNet,
  dayTiles,
  dayTone,
  formatSigned,
  partsOf,
  shortAmount,
  transactionCount,
  type DayItem,
  type DayKind,
} from '../lib/calendarDay';
import '../styles/DayPanel.css';

interface DayPanelProps {
  date: string; // YYYY-MM-DD
  items: DayItem[];
  /** The day's everyday spending is past the page's daily budget. */
  over: boolean;
  /** Everyday spend − daily budget, when known. */
  overBy: number | null;
  onAdd: () => void;
  onEdit: (spending: Spending) => void;
}

const Currency = () => <span className="day-panel-currency">₫</span>;

/** The selected day beside the calendar: its net, what it is made of, and every item on it. */
export function DayPanel({ date, items, over, overBy, onAdd, onEdit }: DayPanelProps) {
  const [filter, setFilter] = useState<DayKind | null>(null);
  const net = dayNet(partsOf(items));
  const tone = dayTone(net, over);
  const tiles = dayTiles(items, over);
  const active = filter && tiles.some(tile => tile.kind === filter) ? filter : null;
  const shown = active ? items.filter(item => item.kind === active) : items;
  const label = format(parseISO(date), 'EEE, d MMM');
  const count = transactionCount(items.length);

  return (
    <section className="day-panel" aria-label={`Day ${label}`}>
      <div className="day-panel-head">
        <div className="day-panel-top">
          <div className="day-panel-main">
            <span className="day-panel-count">
              {count}
              {over && <span className="day-panel-over">{count ? ' · ' : ''}{overBy !== null && overBy > 0 ? `${shortAmount(overBy)} over budget` : 'over budget'}</span>}
            </span>
            <span className={clsx('day-panel-net', `is-${tone}`)}>{formatSigned(net.net)}<Currency /></span>
          </div>
          <button type="button" className="day-panel-add" aria-label={`Add transaction for ${label}`} title="Add transaction" onClick={onAdd}>
            <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        {tiles.length > 0 && (
          <div className="day-panel-tiles" role="group" aria-label="Show only">
            {tiles.map(tile => (
              <button
                key={tile.kind}
                type="button"
                className={clsx('day-panel-tile', `is-${tile.tone}`)}
                aria-label={`${tile.label} ${formatSigned(tile.amount)}, ${transactionCount(tile.count)}`}
                aria-pressed={active === tile.kind}
                onClick={() => setFilter(active === tile.kind ? null : tile.kind)}
              >
                <span className="day-panel-tile-amount">{formatSigned(tile.amount)}</span>
                <span className="day-panel-tile-count">{tile.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="day-panel-list">
        {shown.length === 0 && <p className="day-panel-empty">Nothing on this day</p>}
        {shown.map(item => {
          const rowTone = item.income ? 'in' : item.kind === 'planned' ? 'plan' : 'out';
          const content = (
            <>
              <span className="day-panel-label">{item.label}</span>
              <span className={clsx('day-panel-amount', `is-${rowTone}`, item.expected && 'is-expected')}>
                {formatSigned(item.income ? item.amount : -item.amount)}<Currency />
              </span>
            </>
          );
          const { spending } = item;
          return spending
            ? <button key={item.key} type="button" className="day-panel-row is-button" onClick={() => onEdit(spending)}>{content}</button>
            : <div key={item.key} className="day-panel-row">{content}</div>;
        })}
      </div>
    </section>
  );
}
