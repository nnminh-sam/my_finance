'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';
import { pages } from '../lib/pages';
import { AuthWaiting } from '../components/AuthScreen';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const destination = !loading ? (user ? pages.calendar.path : pages.login.path) : null;

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  return <AuthWaiting message={loading ? 'Restoring your session…' : 'Opening your page…'} />;
}
