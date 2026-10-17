'use client';

import { Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { safeReturnPath } from '../../lib/navigation';
import '../../styles/AuthScreen.css';

function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = !loading && user ? safeReturnPath(searchParams.get('next')) : null;

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  if (loading || destination) {
    return (
      <main className="auth-screen" role="status">
        {loading ? 'Restoring your session…' : 'Opening your page…'}
      </main>
    );
  }

  return <>{children}</>;
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="auth-screen" role="status">
          Restoring your session…
        </main>
      }
    >
      <AuthGuard>{children}</AuthGuard>
    </Suspense>
  );
}
