'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { format } from 'date-fns';
import { User, Mail, Calendar, Tag, ChevronLeft, ChevronRight, Sun, Moon, Monitor, Wallet, SlidersHorizontal, CalendarClock, LogOut, Lock, Copy, Check, Camera, Pencil, RefreshCw, Bot } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { useTheme } from '../contexts/ThemeContext';
import { errorMessage } from '../services/auth';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useDialog } from '../contexts/DialogContext';
import { getRangeIncome } from '../lib/income';
import { DEFAULT_BUDGET_PERIOD, DEFAULT_SHOW_BY, viewPeriodOf } from '../lib/periods';
import { CategoryManager } from './CategoryManager';
import type { CategoryManagerState } from './CategoryManager';
import { EditorActions } from './ProfileSection';
import { BudgetPeriodSection, describeBudgetPeriod } from './BudgetPeriodSection';
import type { BudgetPeriodEditorState } from './BudgetPeriodSection';
import { IncomeSources } from './IncomeSources';
import type { IncomeEditorState } from './IncomeSources';
import { McpAccessSection } from './McpAccessSection';
import '../styles/UserProfile.css';

const TABS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'income', label: 'Income', icon: Wallet },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'paycycle', label: 'Paycycle', icon: CalendarClock },
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

export function UserProfile() {
  const { settings, updateSettings } = useSettings();
  const { user, logout } = useAuth();
  const { theme, preference, setTheme } = useTheme();
  const { incomes, plans, reload } = useFinance();
  const [tab, setTab] = useState<TabId>('account');
  // Phones show a grouped list first; choosing a row pushes that section (null = the list).
  const [mobileSection, setMobileSection] = useState<TabId | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const avatar = useSectionEditor<string>();
  const [categoryEditor, setCategoryEditor] = useState<CategoryManagerState>({ dirty: false, busy: false });
  const [copied, setCopied] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const loggingOut = useRef(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [incomeEditor, setIncomeEditor] = useState<IncomeEditorState>({ dirty: false, busy: false });
  const [budgetEditor, setBudgetEditor] = useState<BudgetPeriodEditorState>({ dirty: false, busy: false });
  const [mcpTokenCount, setMcpTokenCount] = useState<number | undefined>(undefined);
  const unsaved: Record<TabId, boolean> = { account: avatar.dirty, income: incomeEditor.dirty, categories: categoryEditor.dirty, paycycle: budgetEditor.dirty, mcp: false, preferences: false };
  const dirty = Object.values(unsaved).some(Boolean);
  const pending = Boolean(avatar.state?.busy || categoryEditor.busy || incomeEditor.busy || budgetEditor.busy);
  const initials = (user?.name || user?.email || '').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  // The income figure follows Show by: the calendar month, or the pay period that contains today.
  const incomePeriod = viewPeriodOf(settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD, settings.showBy ?? DEFAULT_SHOW_BY, incomes, format(new Date(), 'yyyy-MM-dd'));
  const monthIncome = getRangeIncome(incomePeriod.start, incomePeriod.end, incomes).totalIncome;
  const activeCategories = settings.categories.filter(item => !item.archived).length;
  const counts: Partial<Record<TabId, number>> = { income: incomes.length, categories: activeCategories, ...(mcpTokenCount !== undefined ? { mcp: mcpTokenCount } : {}) };

  const { confirm } = useDialog();
  useUnsavedChanges(!isLoggingOut && (dirty || pending));

  // Sections are linkable as /profile#income and so on.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (isTab(hash)) { setTab(hash); setMobileSection(hash); } else setMobileSection(null);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

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

  const handleLogout = async () => {
    if (loggingOut.current || pending) return;
    if (dirty && !(await confirm({
      title: 'Sign out?',
      message: 'Your unsaved profile changes will be lost.',
      confirmLabel: 'Discard & sign out',
      cancelLabel: 'Keep editing',
      destructive: true,
    }))) return;
    if (loggingOut.current) return;
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

  const openMobileSection = (next: TabId) => {
    selectTab(next);
    setMobileSection(next);
    document.querySelector('.user-profile')?.scrollTo({ top: 0 });
  };
  const closeMobileSection = async () => {
    if (mobileSection && unsaved[mobileSection] && !(await confirm({
      title: 'Discard changes?',
      message: 'Your unsaved changes in this section will be lost.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    }))) return;
    if (mobileSection === 'account' && avatar.state) avatar.cancel();
    setMobileSection(null);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  };
  const themeLabel = preference === null ? `System (${theme})` : preference === 'dark' ? 'Dark' : 'Light';
  const mobileGroups: { title: string; rows: { id: TabId; label: string; value?: string | number }[] }[] = [
    { title: 'Account', rows: [{ id: 'account', label: 'Personal info' }] },
    { title: 'Money', rows: [
      { id: 'income', label: 'Income sources', value: incomes.length },
      { id: 'categories', label: 'Categories', value: activeCategories },
      { id: 'paycycle', label: 'Pay cycle', value: describeBudgetPeriod(settings.budgetPeriod ?? DEFAULT_BUDGET_PERIOD, incomes) },
    ] },
    { title: 'App', rows: [
      { id: 'preferences', label: 'Appearance', value: themeLabel },
      { id: 'mcp', label: 'AI assistants (MCP)', value: mcpTokenCount },
    ] },
  ];

  return (
    <div className={`user-profile hide-scrollbar animate-fade-in ${mobileSection ? 'is-m-detail' : 'is-m-list'}`}>
      <div className="profile-m-home">
        <h1 className="profile-m-title">Profile</h1>
        <div className="profile-m-who">
          <div className="profile-avatar">
            {settings.avatar && failedAvatar !== settings.avatar ? (
              <img src={settings.avatar} alt="" onError={() => setFailedAvatar(settings.avatar)} referrerPolicy="no-referrer" />
            ) : <span aria-hidden="true">{initials || <User size={24} aria-hidden="true" />}</span>}
          </div>
          <div>
            <b>{user?.name}</b>
            <div className="profile-m-muted">{user?.email}</div>
          </div>
        </div>
        {mobileGroups.map(group => (
          <div key={group.title}>
            <h2 className="profile-m-gtitle">{group.title}</h2>
            <div className="profile-m-group">
              {group.rows.map(row => (
                <button key={row.id} type="button" onClick={() => openMobileSection(row.id)}>
                  <span>{row.label}{unsaved[row.id] && <span className="profile-unsaved-dot" title="Unsaved changes"><span className="sr-only">, unsaved changes</span></span>}</span>
                  <span className="profile-m-muted">{row.value ?? ''} <ChevronRight size={16} aria-hidden="true" /></span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="profile-m-group profile-m-signout">
          <button type="button" disabled={isLoggingOut || pending} onClick={() => { void handleLogout(); }}>
            <span>{isLoggingOut ? 'Signing out…' : 'Sign out'}</span><LogOut size={16} aria-hidden="true" />
          </button>
        </div>
        {logoutError && <p role="alert" className="profile-error">{logoutError}</p>}
      </div>
      {mobileSection && (
        <button type="button" className="profile-m-back" onClick={() => { void closeMobileSection(); }}>
          <ChevronLeft size={18} aria-hidden="true" />Profile
        </button>
      )}
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
          <div><dt>{incomePeriod.mode === 'calendar' ? 'Income this month' : 'Income this period'}</dt><dd>{money(monthIncome)}</dd></div>
          <div><dt>Plans</dt><dd>{plans.length}</dd></div>
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
              <div><h2>Categories</h2></div>
              <span className="profile-pill">{activeCategories}</span>
            </div>
            <CategoryManager disabled={isLoggingOut} onEditorStateChange={setCategoryEditor} />
          </section>

          <section id="profile-panel-paycycle" role="tabpanel" aria-labelledby="profile-tab-paycycle" className="profile-panel" hidden={tab !== 'paycycle'}>
            <div className="profile-panel-head"><div><h2>Paycycle</h2><p>How you are paid, and which period the calendar, week, day and analytics views show. Saved to your account.</p></div></div>
            <BudgetPeriodSection disabled={isLoggingOut} onEditorStateChange={setBudgetEditor} />
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
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
