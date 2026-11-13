'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { format, subDays } from 'date-fns';
import {
  Archive, ArchiveRestore, Briefcase, Car, ChevronDown, CircleDollarSign, Coffee, Film, GitMerge, Gift, Heart, Home, MoreHorizontal,
  Palette, Pencil, Phone, Plus, Receipt, Search, ShoppingBag, Utensils,
} from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { useSettings } from '../contexts/SettingsContext';
import { errorMessage } from '../services/auth';
import {
  CATEGORY_SWATCHES, MAX_CATEGORIES, categoryUsage, compactVnd, foldText, nextCategoryLook, sortCategories, validateCategories,
} from '../lib/categories';
import type { CategoryLook, CategorySort } from '../lib/categories';
import type { CategoryData } from '../types';

const ICONS = { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone };
const SORTS: { id: CategorySort; label: string }[] = [{ id: 'use', label: 'Most used' }, { id: 'az', label: 'A–Z' }, { id: 'new', label: 'Newest' }];

export function CategoryGlyph({ category, size = 16 }: { category: CategoryLook; size?: number }) {
  const Icon = ICONS[category.icon as keyof typeof ICONS] || CircleDollarSign;
  return (
    <span className="profile-glyph" style={{ color: category.color, background: `color-mix(in srgb, ${category.color} 15%, transparent)` }} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}

export interface CategoryManagerState { dirty: boolean; busy: boolean }

/** A floating menu or picker, placed against the card from the button that opened it. */
type Float =
  | { kind: 'menu'; id: string; anchor: HTMLElement }
  | { kind: 'look'; id: string | null; anchor: HTMLElement } // id null = the category being added
  | { kind: 'merge'; ids: string[]; anchor: HTMLElement }
  | { kind: 'confirm-merge'; ids: string[]; into: string; anchor: HTMLElement };

interface Notice { text: string; action?: { label: string; run: () => void } }

/**
 * Profile → Categories: an add line, search and sort, and a fixed-height list that scrolls inside itself,
 * so the page is the same height with 10 or 200 categories. Every change saves right away.
 * Remove became Archive: an archived category leaves the pickers but stays in settings, so past spendings keep its name.
 */
export function CategoryManager({ disabled, onEditorStateChange }: { disabled: boolean; onEditorStateChange: (state: CategoryManagerState) => void }) {
  const { settings, updateSettings } = useSettings();
  const { spendings, fetchWeeksSpendings, mergeCategory } = useFinance();
  const all = settings.categories;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CategorySort>('use');
  const [archivedView, setArchivedView] = useState(false);
  const [name, setName] = useState('');
  const [chosenLook, setChosenLook] = useState<CategoryLook | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [float, setFloat] = useState<Float | null>(null);
  const [mergeQuery, setMergeQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [usageReady, setUsageReady] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const [floatStyle, setFloatStyle] = useState<CSSProperties>({});
  const locked = disabled || busy;

  // Use and spend over the last 30 days, from the spendings the app already caches.
  const to = format(new Date(), 'yyyy-MM-dd');
  const from = format(subDays(new Date(), 29), 'yyyy-MM-dd');
  useEffect(() => {
    let live = true;
    fetchWeeksSpendings(from, to).catch(() => undefined).finally(() => { if (live) setUsageReady(true); });
    return () => { live = false; };
  }, [fetchWeeksSpendings, from, to]);
  const usage = useMemo(() => categoryUsage(spendings, from, to), [spendings, from, to]);

  const active = useMemo(() => all.filter(c => !c.archived), [all]);
  const archived = useMemo(() => all.filter(c => c.archived), [all]);
  const look = chosenLook ?? nextCategoryLook(active);
  const unused = usageReady ? active.filter(c => !usage.get(c.id)).length : 0;
  const shown = useMemo(() => {
    const folded = foldText(query);
    const pool = (archivedView ? archived : active).filter(c => !folded || foldText(c.name).includes(folded));
    const sorted = sortCategories(pool, sort, usage);
    // Categories added in this visit stay on top until the list is re-sorted or searched.
    return [...sorted.filter(c => added.has(c.id)), ...sorted.filter(c => !added.has(c.id))];
  }, [query, archivedView, archived, active, sort, usage, added]);

  useEffect(() => {
    onEditorStateChange({ dirty: name.trim() !== '' || renaming !== null, busy });
  }, [name, renaming, busy, onEditorStateChange]);

  // Selection only keeps rows that still exist in the current view.
  useEffect(() => {
    const ids = new Set((archivedView ? archived : active).map(c => c.id));
    setSelected(current => [...current].every(id => ids.has(id)) ? current : new Set([...current].filter(id => ids.has(id))));
  }, [archivedView, archived, active]);

  const save = useCallback(async (next: CategoryData[]): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await updateSettings({ categories: validateCategories(next) });
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }, [updateSettings]);

  // Undo and the delayed custom color run later; they must start from the saved list at that moment, not an old copy.
  const latest = useRef(all);
  latest.current = all;

  const setArchived = useCallback(async (ids: readonly string[], value: boolean) => {
    const set = new Set(ids);
    const current = latest.current;
    const ok = await save(current.map(c => set.has(c.id) ? (value ? { ...c, archived: true } : withoutArchived(c)) : c));
    if (!ok) return;
    setSelected(new Set());
    const count = ids.length === 1 ? `“${current.find(c => c.id === ids[0])?.name}”` : `${ids.length} categories`;
    setNotice(value
      ? { text: `Archived ${count}. Past spendings keep the name.`, action: { label: 'Undo', run: () => { void setArchived(ids, false); } } }
      : { text: `Restored ${count}.` });
  }, [save]);

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed || locked) return;
    const twin = all.find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (twin?.archived) {
      setError(null);
      setNotice({ text: `“${twin.name}” is archived.`, action: { label: 'Restore it', run: () => { setName(''); void setArchived([twin.id], false); } } });
      return;
    }
    if (twin) { setNotice(null); setError(`“${twin.name}” already exists.`); setArchivedView(false); setQuery(twin.name); return; }
    const created: CategoryData = { id: crypto.randomUUID(), name: trimmed, ...look };
    if (await save([...all, created])) {
      setName('');
      setChosenLook(null);
      setQuery('');
      setArchivedView(false);
      setAdded(current => new Set(current).add(created.id));
      setNotice({ text: `Added “${trimmed}”.` });
    }
  };

  // Rename saves on blur only (Enter blurs), once. Escape clears the ref first, so a blur that follows saves nothing.
  const renameRef = useRef(renaming);
  renameRef.current = renaming;
  const renameSaving = useRef(false);
  const cancelRename = () => { renameRef.current = null; setRenaming(null); };
  const commitRename = async () => {
    const draft = renameRef.current;
    if (!draft || renameSaving.current) return;
    const current = latest.current.find(c => c.id === draft.id);
    const value = draft.value.trim();
    if (!current || !value || value === current.name) { cancelRename(); return; }
    renameSaving.current = true;
    try {
      if (await save(latest.current.map(c => c.id === current.id ? { ...c, name: value } : c))) {
        cancelRename();
        setNotice({ text: `Renamed to “${value}”. Past spendings follow.` });
      }
    } finally {
      renameSaving.current = false;
    }
  };

  // A bill category (rent, money for parents, subscriptions) never counts against the calendar's everyday budget.
  const setBill = async (id: string, value: boolean) => {
    const target = latest.current.find(c => c.id === id);
    if (!target) return;
    const ok = await save(latest.current.map(c => c.id === id ? (value ? { ...c, bill: true } : withoutBill(c)) : c));
    if (ok) setNotice({ text: value ? `“${target.name}” is a bill: it no longer counts against the everyday budget.` : `“${target.name}” counts as everyday spending again.` });
  };

  const changeLook = (id: string | null, patch: Partial<CategoryLook>) => {
    if (id === null) { setChosenLook({ ...look, ...patch }); return; }
    void save(latest.current.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  // The custom color input fires while dragging; save once it settles.
  const [customColor, setCustomColor] = useState<{ id: string | null; color: string } | null>(null);
  useEffect(() => {
    if (!customColor) return;
    if (customColor.id === null) { setChosenLook(current => ({ ...(current ?? look), color: customColor.color })); setCustomColor(null); return; }
    const timer = window.setTimeout(() => { changeLook(customColor.id, { color: customColor.color }); setCustomColor(null); }, 500);
    return () => window.clearTimeout(timer);
    // changeLook and look are recreated every render; the timer only needs the latest pick.
  }, [customColor]);

  const merge = async (ids: readonly string[], into: string) => {
    setFloat(null);
    setBusy(true);
    setError(null);
    let spendingsMoved = 0, plansMoved = 0, done = 0;
    try {
      for (const id of ids) {
        const moved = await mergeCategory(id, into);
        spendingsMoved += moved.spendings;
        plansMoved += moved.plans;
        done++;
      }
    } catch (failure) {
      setError(`${done ? `Merged ${done} of ${ids.length}, then: ` : ''}${errorMessage(failure)}`);
    } finally {
      setBusy(false);
    }
    if (done) {
      setSelected(new Set());
      const target = all.find(c => c.id === into)?.name ?? 'the category';
      setNotice({ text: `Merged into “${target}”: ${spendingsMoved} ${spendingsMoved === 1 ? 'spending' : 'spendings'} and ${plansMoved} ${plansMoved === 1 ? 'plan' : 'plans'} moved.` });
    }
  };

  // Floats close on outside press, Escape and list scroll.
  useEffect(() => {
    if (!float) return;
    const onDown = (event: MouseEvent) => {
      if (floatRef.current?.contains(event.target as Node) || float.anchor.contains(event.target as Node)) return;
      setFloat(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setFloat(null); float.anchor.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [float]);

  // Below the button when it fits inside the card, otherwise above; never past the card's sides.
  useLayoutEffect(() => {
    if (!float || !card.current || !floatRef.current) return;
    const box = card.current.getBoundingClientRect(), at = float.anchor.getBoundingClientRect(), size = floatRef.current.getBoundingClientRect();
    const alignRight = float.kind !== 'look';
    let top = at.bottom - box.top + 4;
    if (top + size.height > box.height - 4 && at.top - box.top - size.height - 4 >= 4) top = at.top - box.top - size.height - 4;
    let left = alignRight ? at.right - box.left - size.width : at.left - box.left;
    left = Math.max(4, Math.min(left, box.width - size.width - 4));
    setFloatStyle({ top, left });
  }, [float, mergeQuery]);

  const open = (next: Float) => { setMergeQuery(''); setFloat(current => current && current.anchor === next.anchor && current.kind === next.kind ? null : next); };
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allShownSelected = shown.length > 0 && shown.every(c => selected.has(c.id));
  const nameOf = (id: string) => all.find(c => c.id === id)?.name ?? '';

  const onAddKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); void add(); }
    if (event.key === 'Escape') { setName(''); setChosenLook(null); }
  };

  const floatBody = () => {
    if (!float) return null;
    if (float.kind === 'look') {
      const saved = float.id === null ? look : all.find(c => c.id === float.id) ?? look;
      const target = customColor && customColor.id === float.id ? { ...saved, color: customColor.color } : saved;
      const label = float.id === null ? (name.trim() || 'New category') : nameOf(float.id);
      return (
        <div className="cat-look" role="dialog" aria-label={`Color and icon of ${label}`}>
          <div className="cat-look-head"><CategoryGlyph category={target} /><b>{label}</b></div>
          <div className="profile-swatches" role="group" aria-label="Color">
            {CATEGORY_SWATCHES.map(color => (
              <button key={color} type="button" className="profile-swatch" style={{ background: color }} aria-label={`Color ${color}`} aria-pressed={target.color.toLowerCase() === color} disabled={locked} onClick={() => changeLook(float.id, { color })} />
            ))}
            <label className="profile-swatch profile-swatch-custom" title="Custom color">
              <span className="sr-only">Custom color</span>
              <input type="color" value={target.color} disabled={locked} onChange={event => setCustomColor({ id: float.id, color: event.target.value })} />
            </label>
          </div>
          <div className="profile-icon-grid" role="group" aria-label="Icon">
            {Object.entries(ICONS).map(([icon, Icon]) => (
              <button key={icon} type="button" aria-label={`${icon} icon`} aria-pressed={target.icon === icon} disabled={locked} onClick={() => changeLook(float.id, { icon })}><Icon size={17} aria-hidden="true" /></button>
            ))}
          </div>
        </div>
      );
    }
    if (float.kind === 'menu') {
      const target = all.find(c => c.id === float.id);
      if (!target) return null;
      const item = (label: string, Icon: typeof Pencil, run: () => void, danger = false) => (
        <button type="button" role="menuitem" className={danger ? 'is-danger' : undefined} disabled={locked} onClick={run}><Icon size={15} aria-hidden="true" />{label}</button>
      );
      return (
        <div className="cat-menu" role="menu" aria-label={`Actions for ${target.name}`}>
          {item('Rename', Pencil, () => { setFloat(null); setRenaming({ id: target.id, value: target.name }); })}
          {item('Color & icon', Palette, () => open({ kind: 'look', id: target.id, anchor: float.anchor }))}
          {item(target.bill ? 'Not a bill' : 'Mark as bill', Receipt, () => { setFloat(null); void setBill(target.id, !target.bill); })}
          {target.archived
            ? item('Restore', ArchiveRestore, () => { setFloat(null); void setArchived([target.id], false); })
            : <>
                {item('Merge into…', GitMerge, () => open({ kind: 'merge', ids: [target.id], anchor: float.anchor }))}
                <hr />
                {item('Archive', Archive, () => { setFloat(null); void setArchived([target.id], true); }, true)}
              </>}
        </div>
      );
    }
    if (float.kind === 'merge') {
      const folded = foldText(mergeQuery);
      const options = sortCategories(active.filter(c => !float.ids.includes(c.id) && (!folded || foldText(c.name).includes(folded))), 'use', usage);
      return (
        <div className="cat-menu cat-merge" role="dialog" aria-label="Merge into">
          <span className="cat-menu-title">Merge {float.ids.length === 1 ? `“${nameOf(float.ids[0])}”` : `${float.ids.length} categories`} into</span>
          <label className="cat-search"><Search size={14} aria-hidden="true" /><input autoFocus value={mergeQuery} onChange={event => setMergeQuery(event.target.value)} placeholder="Search" aria-label="Search categories to merge into" /></label>
          <div className="cat-merge-list">
            {options.map(c => (
              <button key={c.id} type="button" disabled={locked} onClick={() => setFloat({ kind: 'confirm-merge', ids: float.ids, into: c.id, anchor: float.anchor })}><CategoryGlyph category={c} size={13} />{c.name}</button>
            ))}
            {options.length === 0 && <span className="cat-menu-title">No category matches</span>}
          </div>
        </div>
      );
    }
    const target = nameOf(float.into);
    return (
      <div className="cat-menu cat-confirm" role="alertdialog" aria-label="Confirm merge">
        <p>All spendings and plans in {float.ids.length === 1 ? <b>{nameOf(float.ids[0])}</b> : <b>{float.ids.length} categories</b>} move to <b>{target}</b>, and {float.ids.length === 1 ? 'it is' : 'they are'} archived. This can’t be undone.</p>
        <div className="profile-actions">
          <button type="button" className="profile-button" onClick={() => setFloat(null)}>Cancel</button>
          <button type="button" className="profile-button profile-button-primary" disabled={locked} autoFocus onClick={() => { void merge(float.ids, float.into); }}><GitMerge size={15} aria-hidden="true" />Merge</button>
        </div>
      </div>
    );
  };

  return (
    <div ref={card} className="profile-card cat-manager">
      <div className="cat-add">
        <button type="button" className="cat-look-btn" aria-label="Color and icon of the new category" aria-expanded={float?.kind === 'look' && float.id === null} disabled={locked} onClick={event => open({ kind: 'look', id: null, anchor: event.currentTarget })}>
          <CategoryGlyph category={look} /><ChevronDown size={13} aria-hidden="true" />
        </button>
        <input value={name} maxLength={100} placeholder="New category" aria-label="New category name" disabled={locked} onChange={event => { setName(event.target.value); setError(null); }} onKeyDown={onAddKey} />
        <button type="button" className="profile-button profile-button-primary" disabled={locked || !name.trim() || all.length >= MAX_CATEGORIES} onClick={() => { void add(); }}><Plus size={16} aria-hidden="true" />Add</button>
      </div>

      <div className="cat-toolbar">
        <label className="cat-search"><Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setAdded(new Set()); }} placeholder={`Search ${archivedView ? archived.length : active.length} ${archivedView ? 'archived' : 'categories'}`} aria-label="Search categories" />
        </label>
        <div className="profile-segmented" role="group" aria-label="Sort">
          {SORTS.map(option => (
            <button key={option.id} type="button" aria-pressed={sort === option.id} onClick={() => { setSort(option.id); setAdded(new Set()); }}>{option.label}</button>
          ))}
        </div>
      </div>

      <div className="cat-scroll" onScroll={() => setFloat(null)}>
        <div className="cat-row cat-head" aria-hidden={shown.length === 0}>
          <input type="checkbox" checked={allShownSelected} aria-label="Select all shown" disabled={locked || shown.length === 0} onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map(c => c.id)))} />
          <span />
          <span>Name</span>
          <span className="cat-num">30 days</span>
          <span className="cat-num cat-spent">Spent</span>
          <span />
        </div>
        <ul className="cat-list" aria-label={archivedView ? 'Archived categories' : 'Categories'}>
          {shown.map(c => {
            const use = usage.get(c.id);
            const isRenaming = renaming?.id === c.id;
            return (
              <li key={c.id} className={`cat-row${selected.has(c.id) ? ' is-selected' : ''}${usageReady && !use && !c.archived ? ' is-unused' : ''}`}>
                <input type="checkbox" checked={selected.has(c.id)} aria-label={`Select ${c.name}`} disabled={locked} onChange={() => toggle(c.id)} />
                <button type="button" className="cat-look-btn is-row" aria-label={`Color and icon of ${c.name}`} aria-expanded={float?.kind === 'look' && float.id === c.id} disabled={locked} onClick={event => open({ kind: 'look', id: c.id, anchor: event.currentTarget })}>
                  <CategoryGlyph category={c} />
                </button>
                {isRenaming ? (
                  <input className="cat-rename" autoFocus value={renaming.value} maxLength={100} aria-label={`Rename ${c.name}`} disabled={busy}
                    onChange={event => setRenaming({ id: c.id, value: event.target.value })}
                    onKeyDown={event => {
                      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                      if (event.key === 'Escape') cancelRename();
                    }}
                    onBlur={() => { void commitRename(); }} />
                ) : (
                  <span className="cat-name" onDoubleClick={() => { if (!locked) setRenaming({ id: c.id, value: c.name }); }}>
                    {c.name}{c.bill && <span className="profile-pill" title="Bill: never counts against the everyday budget">Bill</span>}{added.has(c.id) && <span className="profile-pill">new</span>}
                  </span>
                )}
                <span className="cat-num">{usageReady ? (use ? `${use.count}×` : '—') : '…'}</span>
                <span className="cat-num cat-spent">{use ? `${compactVnd(use.total)} ₫` : ''}</span>
                <button type="button" className="profile-icon-button" aria-label={`Actions for ${c.name}`} aria-haspopup="menu" aria-expanded={float?.kind === 'menu' && float.id === c.id} disabled={locked} onClick={event => open({ kind: 'menu', id: c.id, anchor: event.currentTarget })}>
                  <MoreHorizontal size={17} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        {shown.length === 0 && (
          <p className="profile-empty">
            {query ? 'No category matches.' : archivedView ? 'Nothing archived.' : 'No categories yet. Add one above.'}
          </p>
        )}
      </div>

      {selected.size > 0 ? (
        <div className="cat-foot is-bulk" role="toolbar" aria-label="Selected categories">
          <b>{selected.size} selected</b>
          <span className="cat-sp" />
          {archivedView ? (
            <button type="button" className="profile-button" disabled={locked} onClick={() => { void setArchived([...selected], false); }}><ArchiveRestore size={15} aria-hidden="true" />Restore</button>
          ) : (
            <>
              <button type="button" className="profile-button" disabled={locked} onClick={() => { void setArchived([...selected], true); }}><Archive size={15} aria-hidden="true" />Archive</button>
              <button type="button" className="profile-button" disabled={locked} onClick={event => open({ kind: 'merge', ids: [...selected], anchor: event.currentTarget })}><GitMerge size={15} aria-hidden="true" />Merge into…</button>
            </>
          )}
          <button type="button" className="profile-button profile-button-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : (
        <div className="cat-foot">
          <span className="cat-count">
            {archivedView ? `${archived.length} archived` : `${active.length} ${active.length === 1 ? 'category' : 'categories'}${unused ? ` · ${unused} unused in 30 days` : ''}`}
          </span>
          {notice && (
            <span className="cat-notice" role="status">
              {notice.text}{notice.action && <button type="button" className="cat-link" disabled={locked} onClick={() => { const run = notice.action!.run; setNotice(null); run(); }}>{notice.action.label}</button>}
            </span>
          )}
          <span className="cat-sp" />
          {!archivedView && unused > 0 && (
            <button type="button" className="profile-button" disabled={locked} onClick={() => { setQuery(''); setSelected(new Set(active.filter(c => !usage.get(c.id)).map(c => c.id))); }}>Select unused</button>
          )}
          {(archivedView || archived.length > 0) && (
            <button type="button" className="profile-button profile-button-ghost" onClick={() => { setArchivedView(view => !view); setQuery(''); setAdded(new Set()); setFloat(null); }}>
              {archivedView ? 'Back to categories' : <><Archive size={15} aria-hidden="true" />Archived {archived.length}</>}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="profile-error cat-error">{error}</p>}

      {float && <div ref={floatRef} className="cat-float" style={floatStyle}>{floatBody()}</div>}
    </div>
  );
}

function withoutBill(category: CategoryData): CategoryData {
  const { bill: _bill, ...rest } = category;
  return rest;
}

function withoutArchived(category: CategoryData): CategoryData {
  const { archived: _archived, ...rest } = category;
  return rest;
}
