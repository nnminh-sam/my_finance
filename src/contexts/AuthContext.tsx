'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getAuthState, restoreSession, signIn, signOut, signUp, subscribeAuth } from '../services/auth';
import type { AuthState } from '../services/auth';

interface AuthContextValue extends AuthState {
  login: typeof signIn;
  register: typeof signUp;
  logout: typeof signOut;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState);
  useEffect(() => { void restoreSession(); }, []);
  return (
    <AuthContext.Provider value={{ ...state, login: signIn, register: signUp, logout: signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
