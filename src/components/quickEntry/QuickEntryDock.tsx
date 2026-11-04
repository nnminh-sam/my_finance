'use client';

import { ChevronDown, Trash2 } from 'lucide-react';
import { formatVnd } from '../../lib/quickEntry';
import {
  AmountDisplay, CategoryChips, DetailChips, Keypad, ModeToggle, PANEL_TITLES, PanelBody, QuickError, SourceChips, saveLabelFor,
} from './QuickEntryParts';
import type { QuickEntryController } from './useQuickEntry';

/** Phone (direction A): the keypad dock under the Week ledger, with detail chips and a queue tray. */
export function QuickEntryDock({ qe, dayLabel, pulse, onSave, onNext, onClose, onDelete }: {
  qe: QuickEntryController;
  dayLabel: string;
  pulse?: boolean;
  onSave: () => void;
  onNext: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { entry, panel } = qe;
  const target = qe.editing ? `Editing ${qe.editing.description}` : entry.mode === 'spending' ? `to ${dayLabel}` : 'New income';
  return (
    <section className={`qe-dock${pulse ? ' is-pulse' : ''}`} aria-label="Quick entry">
      <div className="qe-dock-h">
        <ModeToggle qe={qe} small />
        <span className="qe-dock-to">{target}</span>
        {qe.editing && (
          <button type="button" className="qe-fx is-danger" aria-label={`Delete ${qe.editing.description}`} disabled={qe.busy} onClick={onDelete}><Trash2 size={16} /></button>
        )}
        <button type="button" className="qe-fx" aria-label={qe.editing ? 'Stop editing' : 'Hide keypad'} onClick={onClose}><ChevronDown size={18} /></button>
      </div>
      {qe.queue.length > 0 && (
        <button type="button" className="qe-tray" aria-expanded={panel === 'queue'} onClick={() => qe.togglePanel('queue')}>
          <span>{qe.queue.length} queued · {formatVnd(qe.queueTotal)}</span><span>{panel === 'queue' ? 'Hide' : 'Review ›'}</span>
        </button>
      )}
      <AmountDisplay qe={qe} />
      {entry.mode === 'spending' ? <CategoryChips qe={qe} /> : <SourceChips qe={qe} />}
      <DetailChips qe={qe} />
      <QuickError qe={qe} />
      {panel ? (
        <div className="qe-panel">
          <div className="qe-panel-h"><span>{PANEL_TITLES[panel]}</span><button type="button" className="qe-link" onClick={() => qe.togglePanel(null)}>Done</button></div>
          <PanelBody qe={qe} panel={panel} />
        </div>
      ) : (
        <Keypad qe={qe} onSave={onSave} onNext={onNext} saveLabel={saveLabelFor(qe)} />
      )}
    </section>
  );
}
