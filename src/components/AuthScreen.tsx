'use client';

import { useId, useRef, useState } from 'react';
import type { FormEvent, InputHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowBigUp, Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { errorMessage } from '../services/auth';
import { authHref } from '../lib/navigation';
import '../styles/AuthScreen.css';

const MIN_PASSWORD = 12;
type Field = 'name' | 'email' | 'password';
type FieldErrors = Partial<Record<Field, string>>;

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** The wallet mark, drawn inline so it takes the deep brand blue (white on it passes contrast in both themes). */
function AuthLogo() {
  return (
    <span className="auth-logo" aria-hidden="true">
      <svg viewBox="0 0 64 64" width="30" height="30" fill="none">
        <path d="M46 23V19a3 3 0 0 0-3-3H22a6 6 0 0 0-6 6v20a6 6 0 0 0 6 6h24a3 3 0 0 0 3-3V26a3 3 0 0 0-3-3H22a4 4 0 0 1 0-8" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M49 30H39a5 5 0 0 0 0 10h10" stroke="white" strokeWidth="3.5" strokeLinejoin="round" />
        <circle cx="40" cy="35" r="2" fill="white" />
      </svg>
    </span>
  );
}

/** Slow color light behind the auth pages. Decorative; stops moving with reduced motion. */
function AuthBackdrop({ children, busy, label }: { children: ReactNode; busy?: boolean; label?: string }) {
  return (
    <main className="auth-screen" aria-busy={busy || undefined} aria-label={label}>
      <div className="auth-aurora" aria-hidden="true"><i /><i /><i /></div>
      {children}
    </main>
  );
}

/** Shown while the session is restored or the next page opens. */
export function AuthWaiting({ message }: { message: string }) {
  return (
    <AuthBackdrop busy>
      <div className="auth-waiting" role="status">
        <AuthLogo />
        <span className="auth-spinner is-muted" aria-hidden="true" />
        <span className="sr-only">{message}</span>
      </div>
    </AuthBackdrop>
  );
}

export function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const { login, register, error: sessionError } = useAuth();
  const { theme, setTheme } = useTheme();
  const isRegistering = mode === 'signup';
  const targetPage = isRegistering ? 'login' : 'signup';
  const searchParams = useSearchParams();
  const ids = useId();
  const [values, setValues] = useState<Record<Field, string>>({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A session error from the auth context stays until the person starts typing again.
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const banner = error ?? (sessionDismissed ? null : sessionError);
  const fields: Field[] = isRegistering ? ['name', 'email', 'password'] : ['email', 'password'];

  function check(field: Field, value = values[field]): string | undefined {
    if (field === 'name') return value.trim() ? undefined : 'Enter your name.';
    if (field === 'email') {
      if (!value.trim()) return 'Enter your email.';
      return isEmail(value) ? undefined : 'Enter an email like name@gmail.com.';
    }
    if (!value) return 'Enter your password.';
    if (isRegistering && value.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
    return undefined;
  }

  function change(field: Field, value: string) {
    setValues(current => ({ ...current, [field]: value }));
    // A message goes away as soon as the person starts fixing things.
    setFieldErrors(current => (current[field] ? { ...current, [field]: undefined } : current));
    setError(null);
    setSessionDismissed(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const found: FieldErrors = {};
    for (const field of fields) found[field] = check(field);
    setFieldErrors(found);
    const first = fields.find(field => found[field]);
    if (first) { inputs.current[first]?.focus(); return; }
    setBusy(true);
    setError(null);
    setSessionDismissed(true);
    try {
      if (isRegistering) await register(values.name.trim(), values.email.trim(), values.password);
      else await login(values.email.trim(), values.password);
    } catch (failure) {
      setError(errorMessage(failure));
      inputs.current.password?.focus();
    } finally {
      setBusy(false);
    }
  }

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState?.('CapsLock') ?? false);

  const describedBy = (field: Field, ...extra: (string | false)[]) =>
    [fieldErrors[field] && `${ids}-${field}-error`, ...extra].filter(Boolean).join(' ') || undefined;

  const input = (field: Field, label: string, props: InputHTMLAttributes<HTMLInputElement>, after?: ReactNode, below?: ReactNode) => (
    <div className={`auth-field${fieldErrors[field] ? ' is-invalid' : ''}`}>
      <div className="auth-input">
        <input
          ref={element => { inputs.current[field] = element; }}
          id={`${ids}-${field}`}
          name={field}
          placeholder=" "
          value={values[field]}
          onChange={event => change(field, event.target.value)}
          aria-invalid={Boolean(fieldErrors[field])}
          {...props}
        />
        <label htmlFor={`${ids}-${field}`}>{label}</label>
        {after}
      </div>
      {fieldErrors[field] && (
        <p className="auth-field-error" id={`${ids}-${field}-error`}><AlertCircle size={14} aria-hidden="true" />{fieldErrors[field]}</p>
      )}
      {below}
    </div>
  );

  const length = values.password.length;
  const longEnough = length >= MIN_PASSWORD;

  return (
    <AuthBackdrop>
      <button
        type="button"
        className="auth-theme-toggle"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </button>

      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-brand">
          <AuthLogo />
          <span className="auth-app-name">MyFinance</span>
          <h1 id="auth-title">{isRegistering ? 'Create account' : 'Sign in'}</h1>
        </header>

        {searchParams.get('notice') === 'logout-unconfirmed' && (
          <p className="auth-notice" role="status">Sign-out could not be confirmed. Your session may still be active.</p>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <fieldset disabled={busy}>
            {isRegistering && input('name', 'Name', { autoComplete: 'name', maxLength: 100, autoFocus: true, 'aria-describedby': describedBy('name') })}
            {input('email', 'Email', {
              type: 'email', inputMode: 'email', autoComplete: 'username', maxLength: 254, autoFocus: !isRegistering,
              spellCheck: false, autoCapitalize: 'none', 'aria-describedby': describedBy('email'),
              onBlur: () => { if (values.email.trim()) setFieldErrors(current => ({ ...current, email: check('email') })); },
            })}
            {input('password', 'Password', {
              type: showPassword ? 'text' : 'password',
              autoComplete: isRegistering ? 'new-password' : 'current-password',
              maxLength: 128, spellCheck: false, autoCapitalize: 'none',
              onKeyDown: trackCapsLock, onKeyUp: trackCapsLock, onBlur: () => setCapsLock(false),
              'aria-describedby': describedBy('password', capsLock && `${ids}-caps`, isRegistering && `${ids}-meter`),
            }, (
              <button
                type="button"
                className="auth-eye"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onMouseDown={event => event.preventDefault()}
                onClick={() => setShowPassword(shown => !shown)}
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            ), (
              <>
                {capsLock && <p className="auth-caps" id={`${ids}-caps`}><ArrowBigUp size={14} aria-hidden="true" />Caps Lock is on</p>}
                {isRegistering && (
                  <div className={`auth-meter${longEnough ? ' is-ok' : ''}`}>
                    <span className="auth-meter-bar"><i style={{ width: `${Math.min(100, (length / MIN_PASSWORD) * 100)}%` }} /></span>
                    <span id={`${ids}-meter`}>{longEnough ? `${MIN_PASSWORD}+ characters ✓` : `${length} / ${MIN_PASSWORD} characters`}</span>
                  </div>
                )}
              </>
            ))}

            {banner && <p className="auth-banner" role="alert"><AlertCircle size={17} aria-hidden="true" />{banner}</p>}

            <button className="auth-submit" type="submit">
              {busy
                ? <><span className="auth-spinner" aria-hidden="true" /><span className="sr-only">{isRegistering ? 'Creating account…' : 'Signing in…'}</span></>
                : isRegistering ? 'Create account' : 'Sign in'}
            </button>
          </fieldset>
        </form>

        <p className="auth-switch">
          {isRegistering ? 'Have an account? ' : 'New here? '}
          <Link
            href={authHref(targetPage, searchParams.get('next'))}
            aria-disabled={busy}
            onClick={event => { if (busy) event.preventDefault(); }}
          >
            {isRegistering ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </section>
    </AuthBackdrop>
  );
}
