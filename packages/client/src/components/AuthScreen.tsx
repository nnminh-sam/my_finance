import { useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole, Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { errorMessage } from '../auth';
import { authHref } from '../navigation';
import './AuthScreen.css';

export function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const { login, register, error: sessionError } = useAuth();
  const { theme, setTheme } = useTheme();
  const isRegistering = mode === 'signup';
  const targetPage = isRegistering ? 'login' : 'signup';
  const searchParams = new URLSearchParams(window.location.search);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegistering) await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card glass" aria-labelledby="auth-title">
        <div className="auth-toolbar">
          <div className="auth-brand"><img src="/favicon.svg" width={56} height={56} alt="" /></div>
          <button type="button" className="auth-theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
        <p className="auth-app-name">MyFinance</p>
        <h1 id="auth-title">{isRegistering ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-subtitle">{isRegistering ? 'Start tracking your finances with your own account.' : 'Sign in to MyFinance to manage your finances.'}</p>
        {searchParams.get('notice') === 'logout-unconfirmed' && (
          <p className="auth-notice" role="alert">Sign-out could not be confirmed. Your session may still be active.</p>
        )}
        <form onSubmit={handleSubmit} className="auth-form">
          <fieldset disabled={busy}>
            {isRegistering && (
              <label htmlFor="auth-name">Name
                <input id="auth-name" autoComplete="name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} />
              </label>
            )}
            <label htmlFor="auth-email">Email
              <input id="auth-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
            </label>
            <label htmlFor="auth-password">Password
              <input id="auth-password" type="password" autoComplete={isRegistering ? 'new-password' : 'current-password'} required minLength={isRegistering ? 12 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} aria-describedby={isRegistering ? 'password-hint' : undefined} />
            </label>
            {isRegistering && <p id="password-hint" className="auth-hint">Use 12–128 characters. A long, unique passphrase works well.</p>}
            {(error || sessionError) && <p className="auth-error" role="alert">{error || sessionError}</p>}
            <button className="auth-submit" type="submit">{busy ? 'Please wait…' : isRegistering ? 'Create account' : 'Sign in'}</button>
          </fieldset>
        </form>
        <a
          className="auth-switch"
          href={authHref(targetPage, searchParams.get('next'))}
          aria-disabled={busy}
          onClick={event => { if (busy) event.preventDefault(); }}
        >
          {isRegistering ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </a>
        <p className="auth-hint auth-footer"><LockKeyhole size={14} aria-hidden="true" /> Secure sign-in · Your password is never stored in plain text</p>
      </section>
    </main>
  );
}
