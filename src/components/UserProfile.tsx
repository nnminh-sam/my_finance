'use client';

import { useRef, useState } from 'react';
import { User, Mail, Calendar, Tag, Plus, Sun, Moon, Trash2, Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone, Repeat } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { useTheme } from '../contexts/ThemeContext';
import { errorMessage } from '../services/auth';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import type { CategoryData } from '../types';
import { ProfileSection, EditorActions } from './ProfileSection';
import { IncomeSources } from './IncomeSources';
import type { IncomeEditorState } from './IncomeSources';
import '../styles/UserProfile.css';

const ICONS = { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone };

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
  const { theme, setTheme } = useTheme();
  const { repeatRules, deleteRepeatRule } = useFinance();
  const [stoppingRepeatId, setStoppingRepeatId] = useState<string | null>(null);
  const avatar = useSectionEditor<string>();
  const categories = useSectionEditor<CategoryData[]>();
  const appearance = useSectionEditor<'light' | 'dark'>();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const loggingOut = useRef(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [incomeEditor, setIncomeEditor] = useState<IncomeEditorState>({ dirty: false, busy: false });
  const dirty = avatar.dirty || categories.dirty || appearance.dirty || incomeEditor.dirty;
  const pending = Boolean(avatar.state?.busy || categories.state?.busy || appearance.state?.busy || incomeEditor.busy);
  const initials = (user?.name || user?.email || '').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  useUnsavedChanges(!isLoggingOut && (dirty || pending));

  const saveAvatar = () => avatar.save(async draft => {
    const value = draft.trim();
    if (value) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error('Enter a valid HTTP or HTTPS avatar URL, or leave it empty for initials.'); }
      if (value.length > 2048 || !/^https?:\/\//i.test(value) || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error('Use an HTTP or HTTPS URL without embedded credentials, up to 2,048 characters.');
      }
    }
    await updateSettings({ avatar: value });
    setFailedAvatar(null);
  });

  const saveCategories = () => categories.save(async draft => {
    const normalized = draft.map(category => ({ ...category, name: category.name.trim() }));
    const names = new Set<string>();
    if (normalized.length > 50) throw new Error('You can save up to 50 categories.');
    for (const category of normalized) {
      if (!category.name || category.name.length > 100) throw new Error('Each category needs a name of 1–100 characters.');
      const name = category.name.toLowerCase();
      if (names.has(name)) throw new Error('Category names must be unique.');
      names.add(name);
      if (!/^#[0-9a-f]{6}$/i.test(category.color) || !Object.hasOwn(ICONS, category.icon)) {
        throw new Error('Choose a valid color and icon for each category.');
      }
    }
    await updateSettings({ categories: normalized });
  });

  const changeCategory = (id: string, patch: Partial<Pick<CategoryData, 'name' | 'color' | 'icon'>>) => {
    if (categories.state) categories.change(categories.state.draft.map(category => category.id === id ? { ...category, ...patch } : category));
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

  return (
    <div className="user-profile hide-scrollbar animate-fade-in">
      <header className="profile-page-heading">
        <h1>Your profile</h1>
        <p>Manage your profile, income, and personal preferences. Edit each section independently.</p>
      </header>

      <div className="profile-grid">
        <ProfileSection id="profile" title="Profile & avatar" icon={<User size={20} aria-hidden="true" />} editing={avatar.state !== null} onEdit={() => avatar.open(settings.avatar)} wide>
          <div className="profile-identity">
            <div className="profile-avatar">
              {settings.avatar && failedAvatar !== settings.avatar ? (
                <img src={settings.avatar} alt={`${user?.name || 'Your'} profile`} onError={() => setFailedAvatar(settings.avatar)} referrerPolicy="no-referrer" />
              ) : <span aria-label="Profile initials">{initials || <User size={40} aria-hidden="true" />}</span>}
            </div>
            <div className="profile-identity-text">
              <h3>{user?.name}</h3>
              <p><Mail size={16} aria-hidden="true" />{user?.email}</p>
              <p className="profile-hint">Name and email are read-only account credentials.</p>
            </div>
          </div>
          {avatar.state && (
            <form className="profile-form" noValidate aria-label="Edit profile avatar" aria-busy={avatar.state.busy} onSubmit={event => { event.preventDefault(); void saveAvatar(); }}>
              <fieldset disabled={avatar.state.busy}>
                <div className="profile-credentials">
                  <label>Account name (read-only)<input type="text" value={user?.name ?? ''} readOnly /></label>
                  <label>Account email (read-only)<input type="email" value={user?.email ?? ''} readOnly /></label>
                </div>
                <label htmlFor="profile-avatar-url">Avatar URL</label>
                <div className="profile-input-row">
                  <input id="profile-avatar-url" type="url" value={avatar.state.draft} autoFocus maxLength={2048} placeholder="https://example.com/avatar.jpg" aria-invalid={Boolean(avatar.state.error)} aria-describedby={`profile-avatar-help${avatar.state.error ? ' profile-avatar-error' : ''}`} onChange={event => avatar.change(event.target.value)} />
                  <button type="button" className="profile-button" onClick={() => avatar.change('')} aria-label="Clear avatar URL">Clear</button>
                </div>
                <p id="profile-avatar-help" className="profile-hint">Leave empty to use your initials. External images are loaded from the URL you save.</p>
              </fieldset>
              {avatar.state.error && <p id="profile-avatar-error" role="alert" className="profile-error">{avatar.state.error}</p>}
              <EditorActions busy={avatar.state.busy} onCancel={avatar.cancel} />
            </form>
          )}
        </ProfileSection>

        <IncomeSources disabled={isLoggingOut} onEditorStateChange={setIncomeEditor} />

        <ProfileSection id="appearance" title="Appearance" icon={theme === 'light' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />} editing={appearance.state !== null} onEdit={() => appearance.open(theme)}>
          {appearance.state ? (
            <form className="profile-form" aria-label="Edit appearance" aria-busy={appearance.state.busy} onSubmit={event => { event.preventDefault(); void appearance.save(async draft => { setTheme(draft); }); }}>
              <fieldset className="profile-theme-options" disabled={appearance.state.busy}>
                <legend>Color theme</legend>
                <label><input type="radio" name="profile-theme" value="light" checked={appearance.state.draft === 'light'} onChange={() => appearance.change('light')} /><Sun size={18} aria-hidden="true" />Light</label>
                <label><input type="radio" name="profile-theme" value="dark" checked={appearance.state.draft === 'dark'} onChange={() => appearance.change('dark')} /><Moon size={18} aria-hidden="true" />Dark</label>
              </fieldset>
              {appearance.state.error && <p role="alert" className="profile-error">{appearance.state.error}</p>}
              <EditorActions busy={appearance.state.busy} onCancel={appearance.cancel} />
            </form>
          ) : <p>{theme === 'light' ? 'Light' : 'Dark'} theme</p>}
          <p className="profile-hint">This device’s preference. You can also switch themes in the header.</p>
        </ProfileSection>

        <ProfileSection id="categories" title="Categories" icon={<Tag size={20} aria-hidden="true" />} editing={categories.state !== null} onEdit={() => categories.open(settings.categories.map(category => ({ ...category })))} wide>
          {categories.state ? (
            <form className="profile-form" noValidate aria-label="Edit categories" aria-busy={categories.state.busy} onSubmit={event => { event.preventDefault(); void saveCategories(); }}>
              <p id="profile-category-help" className="profile-hint">Renaming keeps the category ID. Removing a category does not delete historical transactions; it removes the category from future choices. Changes apply only when you save.</p>
              <fieldset disabled={categories.state.busy} aria-describedby="profile-category-help">
                <div className="profile-category-editor">
                  {categories.state.draft.map((category, index) => (
                    <div className="profile-category-row" key={category.id}>
                      <label htmlFor={`profile-category-name-${category.id}`}>Name
                        <input id={`profile-category-name-${category.id}`} type="text" value={category.name} maxLength={100} aria-label={`Category ${index + 1} name`} onChange={event => changeCategory(category.id, { name: event.target.value })} />
                      </label>
                      <label htmlFor={`profile-category-color-${category.id}`}>Color
                        <input id={`profile-category-color-${category.id}`} type="color" value={category.color} aria-label={`Category ${index + 1} color`} onChange={event => changeCategory(category.id, { color: event.target.value })} />
                      </label>
                      <label htmlFor={`profile-category-icon-${category.id}`}>Icon
                        <select id={`profile-category-icon-${category.id}`} value={category.icon} aria-label={`Category ${index + 1} icon`} onChange={event => changeCategory(category.id, { icon: event.target.value })}>
                          {Object.keys(ICONS).map(icon => <option key={icon} value={icon}>{icon}</option>)}
                        </select>
                      </label>
                      <button type="button" className="profile-button profile-button-danger" aria-label={`Remove category ${category.name || index + 1}`} onClick={() => categories.change(categories.state!.draft.filter(item => item.id !== category.id))}>
                        <Trash2 size={16} aria-hidden="true" /><span>Remove</span>
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className="profile-button" disabled={categories.state.draft.length >= 50} onClick={() => categories.change([...categories.state!.draft, { id: crypto.randomUUID(), name: '', color: '#10b981', icon: 'CircleDollarSign' }])}>
                  <Plus size={16} aria-hidden="true" />Add category
                </button>
                <p className="profile-hint">{categories.state.draft.length} / 50 categories</p>
              </fieldset>
              {categories.state.error && <p role="alert" className="profile-error">{categories.state.error}</p>}
              <EditorActions busy={categories.state.busy} onCancel={categories.cancel} />
            </form>
          ) : (
            <div className="profile-category-list">
              {settings.categories.map(category => {
                const Icon = ICONS[category.icon as keyof typeof ICONS] || CircleDollarSign;
                return <span key={category.id} className="profile-category-chip" style={{ borderColor: category.color }}><Icon size={16} color={category.color} aria-hidden="true" />{category.name}</span>;
              })}
              {settings.categories.length === 0 && <p className="profile-hint">No categories yet. Edit this section to add one.</p>}
            </div>
          )}
        </ProfileSection>

        <section className="profile-card profile-card-wide glass" aria-labelledby="profile-repeats-heading">
          <h2 id="profile-repeats-heading" className="profile-section-heading">
            <span className="profile-section-title"><Repeat size={20} aria-hidden="true" />Repeat spendings</span>
            <span className="profile-badge">{repeatRules.length}</span>
          </h2>
          <p className="profile-hint">Active repeating spendings automatically track and incrementally apply up to 100 repeats per cycle.</p>
          {repeatRules.length === 0 ? (
            <p className="profile-hint" style={{ padding: '12px 0' }}>No repeat spendings set yet. Toggle “Repeat this spending” when adding breakfast, lunch, gas, etc.</p>
          ) : (
            <div className="profile-repeat-rules-list">
              {repeatRules.map(rule => {
                const category = settings.categories.find(c => c.id === rule.category);
                const formatFreq = () => {
                  if (rule.frequency === 'daily') return rule.interval && rule.interval > 1 ? `Every ${rule.interval} days` : 'Daily';
                  if (rule.frequency === 'weekdays') return 'Weekdays (Mon–Fri)';
                  if (rule.frequency === 'weekly') {
                    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    const selected = (rule.daysOfWeek ?? []).map(d => days[d]).join(', ');
                    return selected ? `Weekly (${selected})` : 'Weekly';
                  }
                  if (rule.frequency === 'monthly') return 'Monthly';
                  return rule.frequency;
                };
                const formatDuration = () => {
                  if (rule.endType === 'unlimited') return 'Unlimited (auto-applying)';
                  if (rule.endType === 'occurrences') return `${rule.occurrencesCreated} / ${rule.totalOccurrences ?? 100} times`;
                  if (rule.endType === 'until_date') return `Until ${rule.endDate}`;
                  return '';
                };
                return (
                  <div key={rule.id} className="profile-repeat-item glass">
                    <div className="profile-repeat-info">
                      <div className="profile-repeat-title-row">
                        <strong>{rule.description}</strong>
                        <span className="profile-repeat-amount">{rule.amount.toLocaleString('vi-VN')} ₫</span>
                      </div>
                      <div className="profile-repeat-meta-row">
                        <span className="profile-repeat-chip" style={{ borderColor: category?.color ?? 'var(--border-color)' }}>
                          {category?.name ?? rule.category}
                        </span>
                        <span>{formatFreq()}</span>
                        <span aria-hidden="true">•</span>
                        <span>{rule.time}</span>
                        <span aria-hidden="true">•</span>
                        <span className="profile-repeat-duration">{formatDuration()}</span>
                      </div>
                      <div className="profile-repeat-tracking-row">
                        <small>Applied: {rule.occurrencesCreated} entries · Latest applied: {rule.lastGeneratedDate ?? 'None'}</small>
                      </div>
                    </div>
                    <div className="profile-repeat-actions">
                      <button
                        type="button"
                        className="profile-button profile-button-danger"
                        disabled={stoppingRepeatId === rule.id || pending}
                        onClick={async () => {
                          if (window.confirm(`Stop repeat spending for “${rule.description}”? Future entries from today onwards will be removed.`)) {
                            setStoppingRepeatId(rule.id);
                            try {
                              await deleteRepeatRule(rule.id, true);
                            } finally {
                              setStoppingRepeatId(null);
                            }
                          }
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        <span>{stoppingRepeatId === rule.id ? 'Stopping…' : 'Stop'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="profile-card profile-card-wide glass" aria-labelledby="profile-account-heading">
          <h2 id="profile-account-heading" className="profile-section-heading"><span className="profile-section-title"><User size={20} aria-hidden="true" />Account details</span></h2>
          <dl className="profile-account-details">
            <div><dt>Member ID</dt><dd>{user?.id ?? '—'}</dd></div>
            <div><dt>Joined date</dt><dd><Calendar size={16} aria-hidden="true" />{user ? <time dateTime={user.createdAt}>{new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time> : '—'}</dd></div>
          </dl>
          <div className="profile-actions"><button type="button" className="profile-button profile-button-danger" disabled={isLoggingOut || pending} onClick={() => { void handleLogout(); }}>{isLoggingOut ? 'Signing out…' : 'Sign out'}</button></div>
          {logoutError && <p role="alert" className="profile-error">{logoutError}</p>}
        </section>
      </div>
    </div>
  );
}
