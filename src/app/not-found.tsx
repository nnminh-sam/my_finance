import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found · MyFinance',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '1.5rem',
        backgroundColor: 'var(--bg-main)',
        color: 'var(--text-main)',
      }}
    >
      <main
        className="glass"
        style={{
          maxWidth: '34rem',
          padding: 'clamp(1.5rem, 5vw, 3rem)',
          borderRadius: '1.5rem',
          border: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: 'var(--primary)',
          }}
        >
          404 · TRACKER
        </p>
        <h1 style={{ fontSize: 'clamp(1.75rem, 6vw, 2.5rem)', lineHeight: 1.15, margin: '0.75rem 0' }}>
          This page couldn’t be found.
        </h1>
        <p style={{ lineHeight: 1.65, color: 'var(--text-muted)' }}>
          The link may be outdated, or the address may have a typo. Head back home to continue tracking your finances.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            marginTop: '1rem',
            padding: '0.75rem 1.25rem',
            borderRadius: '0.75rem',
            backgroundColor: 'var(--primary)',
            color: '#fff',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Back to home
        </Link>
      </main>
    </div>
  );
}
