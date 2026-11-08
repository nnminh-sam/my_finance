'use client';

import { Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { safeReturnPath } from '../../lib/navigation';
import { AuthWaiting } from '../../components/AuthScreen';

function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = !loading && user ? safeReturnPath(searchParams.get('next')) : null;

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  if (loading || destination) {
    return <AuthWaiting message={loading ? 'Restoring your session…' : 'Opening your page…'} />;
  }

  return <>{children}</>;
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={<AuthWaiting message="Restoring your session…" />}
    >
      <AuthGuard>{children}</AuthGuard>
    </Suspense>
  );
}
