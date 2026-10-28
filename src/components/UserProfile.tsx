'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { User, Mail, Calendar, Tag, Plus, Sun, Moon, Monitor, Trash2, Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone, Repeat, Wallet, SlidersHorizontal, LogOut, Lock, Copy, Check, Camera, Pencil, CircleStop, RefreshCw, Bot } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { useTheme } from '../contexts/ThemeContext';
import { errorMessage } from '../services/auth';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { getMonthIncome, incomeMonth } from '../lib/income';
import { describeRepeatFrequency, monthlyRepeatCost, repeatProgress } from '../lib/repeatRules';
import { clampSalaryDay, defaultSalaryCycleConfig, loadSalaryCycleConfig, saveSalaryCycleConfig } from '../lib/salaryCycle';
import type { SalaryCycleConfig } from '../lib/salaryCycle';
import type { CategoryData } from '../types';
import { EditorActions } from './ProfileSection';
import { IncomeSources } from './IncomeSources';
import type { IncomeEditorState } from './IncomeSources';
import { McpAccessSection } from './McpAccessSection';
import '../styles/UserProfile.css';

const ICONS = { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone };
const SWATCHES = ['#f43f5e', '#f97316', '#eab308', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];
const MAX_CATEGORIES = 50;

const TABS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'income', label: 'Income', icon: Wallet },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'repeats', label: 'Repeat spendings', icon: Repeat },
  { id: 'mcp', label: 'AI & MCP', icon: Bot },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
] as const;
type TabId = typeof TABS[number]['id'];
const isTab = (value: string): value is TabId => TABS.some(tab => tab.id === value);

const money = (amount: number) => `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ₫`;

type EditorState<T> = { draft: T; snapshot: T; busy: boolean; error: string | null };

// Compare with the opening snapshot, not settings changed by another section's save.
function useSectionEditor<T>() {
  const [state, setState] = useState<EditorState<T> | null>(null);
  const saving = useRef(false);
  const dirty = state !== null && JSON.stringify(state.draft) !== JSON.stringify(state.snapshot);

  const open = (snapshot: T) => {
    if (!saving.current) setState({ draft: snapshot, snapshot, busy: false, error: null });
  };
  const change = (draft: T) => {
    if (!saving.current) setState(current => current && { ...current, draft, error: null });
  };
  const cancel = () => {
    if (!saving.current) setState(null);
  };
  const save = async (persist: (draft: T) => Promise<void>) => {
    if (!state || saving.current) return;
    saving.current = true;
    setState(current => current && { ...current, busy: true, error: null });
    try {
      await persist(state.draft);
      setState(null);
    } catch (failure) {
      setState(current => current && { ...current, busy: false, error: errorMessage(failure) });
    } finally {
      saving.current = false;
    }
  };

  return { state, dirty, open, change, cancel, save };
}

function validateCategories(categories: CategoryData[]): CategoryData[] {
  const normalized = categories.map(category => ({ ...category, name: category.name.trim() }));
  const names = new Set<string>();
  if (normalized.length > MAX_CATEGORIES) throw new Error(`You can save up to ${MAX_CATEGORIES} categories.`);
  for (const category of normalized) {
    if (!category.name || category.name.length > 100) throw new Error('Give the category a name of 1–100 characters.');
    const name = category.name.toLowerCase();
    if (names.has(name)) throw new Error(`Another category is already called “${category.name}”.`);
    names.add(name);
    if (!/^#[0-9a-f]{6}$/i.test(category.color) || !Object.hasOwn(ICONS, category.icon)) {
      throw new Error('Choose a valid color and icon.');
    }
  }
  return normalized;
}

function CategoryGlyph({ category, size = 18 }: { category: Pick<CategoryData, 'color' | 'icon'>; size?: number }) {
  const Icon = ICONS[category.icon as keyof typeof ICONS] || CircleDollarSign;
  return (
    <span className="profile-glyph" style={{ color: category.color, background: `color-mix(in srgb, ${category.color} 15%, transparent)` }} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}

export function UserProfile() {
  const { settings, updateSettings } = useSettings();
  const { user, logout } = useAuth();
  const { theme, preference, setTheme } = useTheme();
  const { incomes, repeatRules, deleteRepeatRule, reload } = useFinance();
  const [tab, setTab] = useState<TabId>('account');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const avatar = useSectionEditor<string>();
  const category = useSectionEditor<CategoryData & { isNew: boolean }>();
  const [confirmRemoveCategory, setConfirmRemoveCategory] = useState(false);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const [stoppingRepeatId, setStoppingRepeatId] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<SalaryCycleConfig>(defaultSalaryCycleConfig);
  const [copied, setCopied] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const loggingOut = useRef(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [incomeEditor, setIncomeEditor] = useState<IncomeEditorState>({ dirty: false, busy: false });
  const [mcpTokenCount, setMcpTokenCount] = useState<number | undefined>(undefined);
  const categoryDirty = category.state !== null && (category.state.draft.isNew || category.dirty);
  const unsaved: Record<TabId, boolean> = { account: avatar.dirty, income: incomeEditor.dirty, categories: categoryDirty, repeats: false, mcp: false, preferences: false };
  const dirty = Object.values(unsaved).some(Boolean);
  const pending = Boolean(avatar.state?.busy || category.state?.busy || incomeEditor.busy || stoppingRepeatId);
  const initials = (user?.name || user?.email || '').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const monthIncome = getMonthIncome(incomeMonth(new Date()), incomes).totalIncome;
  const monthlyRepeats = repeatRules.reduce((sum, rule) => sum + monthlyRepeatCost(rule), 0);
  const counts: Partial<Record<TabId, number>> = { income: incomes.length, categories: settings.categories.length, repeats: repeatRules.length, ...(mcpTokenCount !== undefined ? { mcp: mcpTokenCount } : {}) };

  useUnsavedChanges(!isLoggingOut && (dirty || pending));

  // Sections are linkable as /profile#income and so on.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (isTab(hash)) setTab(hash);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  useEffect(() => {
    setCycle(loadSalaryCycleConfig(user?.id));
  }, [user?.id]);

  const selectTab = (next: TabId, focus = false) => {
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
    if (focus) tabRefs.current[next]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex(item => item.id === tab);
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    selectTab(TABS[(moves[event.key] + TABS.length) % TABS.length].id, true);
  };

  const openAvatar = () => {
    selectTab('account');
    if (!avatar.state) avatar.open(settings.avatar);
  };

  const saveAvatar = () => avatar.save(async draft => {
    const value = draft.trim();
    if (value) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error('Enter a valid HTTP or HTTPS image URL, or leave it empty to use your initials.'); }
      if (value.length > 2048 || !/^https?:\/\//i.test(value) || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error('Use an HTTP or HTTPS URL without embedded credentials, up to 2,048 characters.');
      }
    }
    await updateSettings({ avatar: value });
    setFailedAvatar(null);
  });

  const copyMemberId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the ID stays selectable on screen.
    }
  };

  const openCategory = (next: CategoryData | null) => {
    if (category.state?.busy) return;
    if (categoryDirty && !window.confirm('Discard unsaved category changes?')) return;
    setConfirmRemoveCategory(false);
    if (next) category.open({ ...next, isNew: false });
    else category.open({ id: crypto.randomUUID(), name: '', color: '#10b981', icon: 'CircleDollarSign', isNew: true });
  };

  const changeCategory = (patch: Partial<Pick<CategoryData, 'name' | 'color' | 'icon'>>) => {
    if (category.state) category.change({ ...category.state.draft, ...patch });
  };

  const saveCategory = () => category.save(async ({ isNew, ...draft }) => {
    const next = isNew ? [...settings.categories, draft] : settings.categories.map(item => item.id === draft.id ? draft : item);
    await updateSettings({ categories: validateCategories(next) });
  });

  const removeCategory = () => category.save(async ({ id }) => {
    await updateSettings({ categories: settings.categories.filter(item => item.id !== id) });
    setConfirmRemoveCategory(false);
  });

  const stopRepeat = async (id: string) => {
    setStoppingRepeatId(id);
    setRepeatError(null);
    try {
      await deleteRepeatRule(id, true);
      setConfirmStopId(null);
    } catch (failure) {
      setRepeatError(`Could not stop the repeat: ${errorMessage(failure)}`);
    } finally {
      setStoppingRepeatId(null);
    }
  };

  const updateCycle = (patch: Partial<SalaryCycleConfig>) => {
    const next = { ...cycle, ...patch };
    setCycle(next);
    saveSalaryCycleConfig(next, user?.id);
  };

  const handleLogout = async () => {
    if (loggingOut.current || pending) return;
    if (dirty && !window.confirm('Discard unsaved profile changes and sign out?')) return;
    loggingOut.current = true;
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch (failure) {
      setLogoutError(errorMessage(failure));
    } finally {
      loggingOut.current = false;
      setIsLoggingOut(false);
    }
  };

  const signOutButton = (className: string) => (
    <button type="button" className={className} disabled={isLoggingOut || pending} onClick={() => { void handleLogout(); }}>
      <LogOut size={16} aria-hidden="true" />{isLoggingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );

  const editing = category.state?.draft;

  return (
    <div className="user-profile hide-scrollbar animate-fade-in">
      <header className="profile-identity profile-card" aria-label="Your account">
        <div className="profile-avatar">
          {settings.avatar && failedAvatar !== settings.avatar ? (
            <img src={settings.avatar} alt={`${user?.name || 'Your'} profile`} onError={() => setFailedAvatar(settings.avatar)} referrerPolicy="no-referrer" />
          ) : <span aria-label="Profile initials">{initials || <User size={28} aria-hidden="true" />}</span>}
          <button type="button" className="profile-avatar-edit" aria-label="Change profile photo" onClick={openAvatar}><Camera size={14} aria-hidden="true" /></button>
        </div>
        <div className="profile-who">
          <h1>{user?.name}</h1>
          <p className="profile-meta">
            <span><Mail size={15} aria-hidden="true" />{user?.email}</span>
            {user && <span><Calendar size={15} aria-hidden="true" />Member since <time dateTime={user.createdAt}>{new Date(user.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</time></span>}
          </p>
        </div>
        <dl className="profile-stats">
          <div><dt>Income this month</dt><dd>{money(monthIncome)}</dd></div>
          <div><dt>Repeats per month</dt><dd>≈ {money(monthlyRepeats)}</dd></div>
        </dl>
      </header>

      <div className="profile-shell">
        <nav className="profile-rail profile-card" aria-label="Profile sections">
          <div role="tablist" aria-orientation="vertical" className="profile-tabs">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                ref={element => { tabRefs.current[id] = element; }}
                type="button"
                role="tab"
                id={`profile-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`profile-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => selectTab(id)}
                onKeyDown={onTabKeyDown}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {unsaved[id] && <span className="profile-unsaved-dot" title="Unsaved changes"><span className="sr-only">, unsaved changes</span></span>}
                {counts[id] !== undefined && <span className="profile-tab-count">{counts[id]}</span>}
              </button>
            ))}
          </div>
          <hr />
          {signOutButton('profile-rail-signout')}
        </nav>

        <div className="profile-panels">
          <section id="profile-panel-account" role="tabpanel" aria-labelledby="profile-tab-account" className="profile-panel" hidden={tab !== 'account'}>
            <div className="profile-panel-head"><div><h2>Account</h2><p>Your sign-in details and profile photo.</p></div></div>
            <dl className="profile-card profile-rows">
              <div className="profile-row">
                <dt>Profile photo</dt>
                {avatar.state ? (
                  <dd className="profile-row-wide">
                    <form className="profile-form" noValidate aria-label="Edit profile photo" aria-busy={avatar.state.busy} onSubmit={event => { event.preventDefault(); void saveAvatar(); }}>
                      <fieldset disabled={avatar.state.busy}>
                        <label htmlFor="profile-avatar-url" className="sr-only">Image URL</label>
                        <input id="profile-avatar-url" type="url" value={avatar.state.draft} autoFocus maxLength={2048} placeholder="https://example.com/avatar.jpg" aria-invalid={Boolean(avatar.state.error)} aria-describedby={`profile-avatar-help${avatar.state.error ? ' profile-avatar-error' : ''}`} onChange={event => avatar.change(event.target.value)} />
                        <p id="profile-avatar-help" className="profile-hint">Paste an image link. Leave it empty to use your initials.</p>
                      </fieldset>
                      {avatar.state.error && <p id="profile-avatar-error" role="alert" className="profile-error">{avatar.state.error}</p>}
                      <EditorActions busy={avatar.state.busy} onCancel={avatar.cancel} />
                    </form>
                  </dd>
                ) : (
                  <>
                    <dd>{settings.avatar ? <span className="profile-truncate">{settings.avatar}</span> : 'Using your initials'}</dd>
                    <button type="button" className="profile-button" onClick={() => avatar.open(settings.avatar)}><Pencil size={16} aria-hidden="true" />Change</button>
                  </>
                )}
              </div>
              <div className="profile-row"><dt>Name</dt><dd>{user?.name}</dd><span className="profile-lock"><Lock size={13} aria-hidden="true" />Set at sign-up</span></div>
              <div className="profile-row"><dt>Email</dt><dd>{user?.email}</dd><span className="profile-lock"><Lock size={13} aria-hidden="true" />Sign-in email</span></div>
              <div className="profile-row">
                <dt>Member ID</dt>
                <dd className="profile-mono">{user?.id ?? '—'}</dd>
                <button type="button" className="profile-icon-button" disabled={!user?.id} aria-label={copied ? 'Member ID copied' : 'Copy member ID'} onClick={() => { void copyMemberId(); }}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                </button>
              </div>
              <div className="profile-row">
                <dt>Joined</dt>
                <dd>{user ? <time dateTime={user.createdAt}>{new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time> : '—'}</dd>
              </div>
            </dl>
            <div className="profile-card profile-signout-card">
              <div><h3>Sign out</h3><p className="profile-hint">Ends your session on this device. Unsaved edits on this page are lost.</p></div>
              <div className="profile-actions">
                <button
                  type="button"
                  className="profile-button"
                  disabled={isRefreshing || isLoggingOut || pending}
                  onClick={async () => {
                    setIsRefreshing(true);
                    setLogoutError(null);
                    try {
                      await reload();
                    } catch (failure) {
                      setLogoutError(errorMessage(failure));
                    } finally {
                      setIsRefreshing(false);
                    }
                  }}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  <span>{isRefreshing ? 'Refreshing…' : 'Refresh records'}</span>
                </button>
                {signOutButton('profile-button profile-button-danger')}
              </div>
            </div>
            {logoutError && <p role="alert" className="profile-error">{logoutError}</p>}
          </section>

          <div id="profile-panel-income" role="tabpanel" aria-labelledby="profile-tab-income" hidden={tab !== 'income'}>
            <IncomeSources disabled={isLoggingOut} onEditorStateChange={setIncomeEditor} />
          </div>

          <section id="profile-panel-categories" role="tabpanel" aria-labelledby="profile-tab-categories" className="profile-panel" hidden={tab !== 'categories'}>
            <div className="profile-panel-head">
              <div><h2>Categories</h2><p>Used to label spendings. Renaming keeps past spendings linked. Removing a category hides it from new spendings and keeps past ones.</p></div>
              <span className="profile-pill">{settings.categories.length} / {MAX_CATEGORIES}</span>
            </div>
            <div className="profile-card">
              <div className="profile-category-grid">
                {settings.categories.map(item => {
                  const shown = editing?.id === item.id ? editing : item;
                  return (
                    <button key={item.id} type="button" className="profile-category-tile" aria-expanded={editing?.id === item.id} aria-controls="profile-category-editor" onClick={() => openCategory(item)}>
                      <CategoryGlyph category={shown} />
                      <span>{shown.name || 'Untitled'}</span>
                    </button>
                  );
                })}
                {editing?.isNew && (
                  <button type="button" className="profile-category-tile" aria-expanded="true" aria-controls="profile-category-editor">
                    <CategoryGlyph category={editing} />
                    <span>{editing.name || 'New category'}</span>
                  </button>
                )}
                {!editing?.isNew && (
                  <button type="button" className="profile-category-tile profile-category-add" disabled={settings.categories.length >= MAX_CATEGORIES} onClick={() => openCategory(null)}>
                    <Plus size={18} aria-hidden="true" />Add category
                  </button>
                )}
              </div>
              {category.state && editing && (
                <form id="profile-category-editor" className="profile-category-editor" noValidate aria-label={editing.isNew ? 'Add category' : `Edit ${category.state.snapshot.name}`} aria-busy={category.state.busy} onSubmit={event => { event.preventDefault(); void saveCategory(); }}>
                  <fieldset disabled={category.state.busy}>
                    <label className="profile-field-full">Name
                      <input type="text" value={editing.name} maxLength={100} autoFocus placeholder="e.g. Groceries" aria-invalid={Boolean(category.state.error)} onChange={event => changeCategory({ name: event.target.value })} />
                    </label>
                    <div className="profile-field" role="group" aria-labelledby="profile-category-color-label">
                      <span id="profile-category-color-label">Color</span>
                      <div className="profile-swatches">
                        {SWATCHES.map(color => (
                          <button key={color} type="button" className="profile-swatch" style={{ background: color }} aria-label={`Color ${color}`} aria-pressed={editing.color.toLowerCase() === color} onClick={() => changeCategory({ color })} />
                        ))}
                        <label className="profile-swatch profile-swatch-custom" title="Custom color">
                          <span className="sr-only">Custom color</span>
                          <input type="color" value={editing.color} onChange={event => changeCategory({ color: event.target.value })} />
                        </label>
                      </div>
                    </div>
                    <div className="profile-field" role="group" aria-labelledby="profile-category-icon-label">
                      <span id="profile-category-icon-label">Icon</span>
                      <div className="profile-icon-grid">
                        {Object.entries(ICONS).map(([name, Icon]) => (
                          <button key={name} type="button" aria-label={`${name} icon`} aria-pressed={editing.icon === name} onClick={() => changeCategory({ icon: name })}><Icon size={18} aria-hidden="true" /></button>
                        ))}
                      </div>
                    </div>
                  </fieldset>
                  {category.state.error && <p role="alert" className="profile-error profile-field-full">{category.state.error}</p>}
                  <div className="profile-editor-footer profile-field-full">
                    {editing.isNew ? <span /> : confirmRemoveCategory ? (
                      <div className="profile-actions">
                        <span className="profile-hint">Remove “{category.state.snapshot.name}”? Past spendings keep it.</span>
                        <button type="button" className="profile-button" disabled={category.state.busy} onClick={() => setConfirmRemoveCategory(false)}>Keep</button>
                        <button type="button" className="profile-button profile-button-danger" disabled={category.state.busy} onClick={() => { void removeCategory(); }}>Remove</button>
                      </div>
                    ) : (
                      <button type="button" className="profile-button profile-button-danger" disabled={category.state.busy} onClick={() => setConfirmRemoveCategory(true)}><Trash2 size={16} aria-hidden="true" />Remove category</button>
                    )}
                    <EditorActions busy={category.state.busy} onCancel={() => { setConfirmRemoveCategory(false); category.cancel(); }} />
                  </div>
                </form>
              )}
            </div>
          </section>

          <section id="profile-panel-repeats" role="tabpanel" aria-labelledby="profile-tab-repeats" className="profile-panel" hidden={tab !== 'repeats'}>
            <div className="profile-panel-head"><div><h2>Repeat spendings</h2><p>Created when you turn on “Repeat this spending” while adding a spending. Up to 100 entries are added at a time. Stopping a repeat removes its entries from today onward.</p></div></div>
            {repeatRules.length === 0 ? (
              <p className="profile-card profile-empty">No repeat spendings yet. Turn on “Repeat this spending” when you add breakfast, gas, rent and other regular costs.</p>
            ) : (
              <>
                <dl className="profile-card profile-summary">
                  <div><dt>Estimated per month</dt><dd>≈ {money(monthlyRepeats)}</dd></div>
                  <div><dt>Active repeats</dt><dd>{repeatRules.length}</dd></div>
                  <div><dt>Entries created</dt><dd>{repeatRules.reduce((sum, rule) => sum + rule.occurrencesCreated, 0)}</dd></div>
                </dl>
                <ul className="profile-card profile-list" aria-label="Repeat spendings">
                  {repeatRules.map(rule => {
                    const ruleCategory = settings.categories.find(item => item.id === rule.category);
                    const progress = repeatProgress(rule);
                    return (
                      <li key={rule.id} className="profile-list-item">
                        <CategoryGlyph category={ruleCategory ?? { color: '#64748b', icon: 'CircleDollarSign' }} />
                        <div className="profile-list-main">
                          <strong>{rule.description}</strong>
                          <span className="profile-meta">
                            <span className="profile-pill">{describeRepeatFrequency(rule)}</span>
                            <span>{rule.time}</span>
                            <span>{ruleCategory?.name ?? rule.category}</span>
                            {rule.endType === 'until_date' && <span>Until {rule.endDate}</span>}
                            {rule.endType === 'unlimited' && <span>No end date</span>}
                          </span>
                          {progress && (
                            <span className="profile-progress" role="progressbar" aria-label={`${rule.description} repeats`} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                              <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                            </span>
                          )}
                        </div>
                        <div className="profile-amount">
                          {money(rule.amount)}
                          <small>{progress ? `${progress.done} / ${progress.total} times` : `≈ ${money(monthlyRepeatCost(rule))} / month`}</small>
                        </div>
                        <div className="profile-row-actions">
                          {confirmStopId === rule.id ? (
                            <>
                              <button type="button" className="profile-button" disabled={stoppingRepeatId === rule.id} onClick={() => setConfirmStopId(null)}>Keep</button>
                              <button type="button" className="profile-button profile-button-danger" disabled={stoppingRepeatId === rule.id || isLoggingOut} onClick={() => { void stopRepeat(rule.id); }}>
                                {stoppingRepeatId === rule.id ? 'Stopping…' : 'Stop from today'}
                              </button>
                            </>
                          ) : (
                            <button type="button" className="profile-button profile-button-ghost profile-button-danger" disabled={pending || isLoggingOut} aria-label={`Stop repeating ${rule.description}`} onClick={() => { setRepeatError(null); setConfirmStopId(rule.id); }}>
                              <CircleStop size={16} aria-hidden="true" />Stop
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {repeatError && <p role="alert" className="profile-error">{repeatError}</p>}
              </>
            )}
          </section>

          <div id="profile-panel-mcp" role="tabpanel" aria-labelledby="profile-tab-mcp" hidden={tab !== 'mcp'}>
            <McpAccessSection disabled={isLoggingOut} onCountChange={setMcpTokenCount} />
          </div>

          <section id="profile-panel-preferences" role="tabpanel" aria-labelledby="profile-tab-preferences" className="profile-panel" hidden={tab !== 'preferences'}>
            <div className="profile-panel-head"><div><h2>Preferences</h2><p>Changes apply right away and are saved on this device.</p></div></div>
            <div className="profile-card profile-rows">
              <div className="profile-pref">
                <div><strong id="profile-theme-label">Theme</strong><span className="profile-hint">System follows your device. You can also switch themes from the header.</span></div>
                <div className="profile-segmented" role="group" aria-labelledby="profile-theme-label">
                  <button type="button" aria-pressed={preference === 'light'} onClick={() => setTheme('light')}><Sun size={15} aria-hidden="true" />Light</button>
                  <button type="button" aria-pressed={preference === 'dark'} onClick={() => setTheme('dark')}><Moon size={15} aria-hidden="true" />Dark</button>
                  <button type="button" aria-pressed={preference === null} onClick={() => setTheme(null)}><Monitor size={15} aria-hidden="true" />System{preference === null ? ` (${theme})` : ''}</button>
                </div>
              </div>
              <div className="profile-pref">
                <div><label htmlFor="profile-payday"><strong>Payday</strong></label><span className="profile-hint">The day of the month each salary cycle starts. Adjust a single month from the Cycle view.</span></div>
                <select id="profile-payday" value={cycle.salaryDay} onChange={event => updateCycle({ salaryDay: clampSalaryDay(Number(event.target.value)) })}>
                  {Array.from({ length: 28 }, (_, index) => index + 1).map(day => <option key={day} value={day}>Day {day}</option>)}
                </select>
              </div>
              <div className="profile-pref">
                <div><label htmlFor="profile-weekend-shift"><strong>Move weekend paydays to Monday</strong></label><span className="profile-hint">When payday falls on a Saturday or Sunday, the cycle starts the following Monday.</span></div>
                <input id="profile-weekend-shift" type="checkbox" role="switch" className="profile-switch" checked={cycle.shiftWeekendToMonday} onChange={event => updateCycle({ shiftWeekendToMonday: event.target.checked })} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
