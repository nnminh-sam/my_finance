'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Briefcase, Car, CircleDollarSign, Coffee, Film, Gift, Heart, Home, Phone, Receipt, ShoppingBag, Utensils,
} from 'lucide-react';
import type { CategoryData } from '../../types';

const ICONS = { Utensils, Car, Film, ShoppingBag, Receipt, CircleDollarSign, Coffee, Home, Heart, Briefcase, Gift, Phone };

export function CategoryIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const Icon = ICONS[icon as keyof typeof ICONS] ?? CircleDollarSign;
  return <Icon size={size} aria-hidden="true" />;
}

export function categoryMeta(categories: readonly CategoryData[], id: string): Pick<CategoryData, 'name' | 'color' | 'icon'> {
  return categories.find(category => category.id === id) ?? { name: id, color: '#64748b', icon: 'CircleDollarSign' };
}

/** Light haptic tick where the browser supports it (Android Chrome). */
export function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

export interface ToastState { id: number; message: string; undo?: () => void }

/** One transient message at a time, with an optional Undo action. */
export function useToast(duration = 3800) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, undo?: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, undo });
    timer.current = setTimeout(() => setToast(null), duration);
  }, [duration]);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { toast, show, hide };
}

export function Toast({ toast, onHide, top = false }: { toast: ToastState | null; onHide: () => void; top?: boolean }) {
  return (
    <div className={`m-toast${toast ? ' is-on' : ''}${top ? ' is-top' : ''}`} role="status" aria-live="polite">
      {toast && (
        <>
          <span>{toast.message}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo?.(); onHide(); }}>Undo</button>}
        </>
      )}
    </div>
  );
}

export interface AlertButton { label: string; destructive?: boolean; onPress: () => void }

/** A native-style alert: title, message and a row of buttons. */
export function MobileAlert({ title, message, buttons, onDismiss }: { title: string; message?: ReactNode; buttons: AlertButton[]; onDismiss: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onDismiss(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDismiss]);
  return (
    <div className="m-alert-layer" onClick={onDismiss}>
      <div className="m-alert" role="alertdialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
        <div className="m-alert-body">
          <b>{title}</b>
          {message && <p>{message}</p>}
        </div>
        <div className="m-alert-actions">
          {buttons.map((button, i) => (
            <button key={button.label} ref={i === 0 ? first : undefined} type="button" className={button.destructive ? 'is-destructive' : undefined} onClick={button.onPress}>
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Plain-language explanation behind an ⓘ button on a chart card. */
export function InfoCard({ title, info, children, right }: { title: string; info?: string; children: ReactNode; right?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="m-card">
      <h2 className="m-card-title">
        <span>{title}</span>
        <span className="m-card-right">
          {right}
          {info && (
            <button type="button" className="m-info" aria-expanded={open} aria-label={`About ${title}`} onClick={() => setOpen(value => !value)}>ⓘ</button>
          )}
        </span>
      </h2>
      {open && info && <p className="m-info-text">{info}</p>}
      {children}
    </section>
  );
}
