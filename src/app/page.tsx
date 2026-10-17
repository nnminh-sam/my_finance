'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';
import { pages } from '../lib/pages';
import '../styles/AuthScreen.css';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const destination = !loading ? (user ? pages.calendar.path : pages.login.path) : null;

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  return (
    <main className="auth-screen" role="status">
      {loading ? 'Restoring your session…' : 'Opening your page…'}
    </main>
  );
}
