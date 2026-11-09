'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import '../styles/Alert.css';

export interface AlertButton { label: string; destructive?: boolean; primary?: boolean; onPress: () => void }

/**
 * The app's alert: title, message and a row of buttons, in place of the browser's alert/confirm/prompt.
 * Opened with showModal() so it sits in the top layer, above any other modal dialog that is already open.
 * The first button gets focus, unless a child is marked `data-autofocus` (the prompt's input).
 */
export function SystemAlert({ title, message, buttons, onDismiss, vertical = false, children }: {
  title: string;
  message?: ReactNode;
  buttons: AlertButton[];
  onDismiss: () => void;
  vertical?: boolean;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!node.open) node.showModal();
    const target = node.querySelector<HTMLElement>('[data-autofocus]') ?? first.current;
    target?.focus();
    return () => { if (node.open) node.close(); };
  }, []);

  useEffect(() => {
    // Capture so the dialog underneath (quick entry, income) does not also treat this Escape as its own.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDismiss]);

  return (
    <dialog
      ref={dialog}
      className="m-alert-layer"
      aria-label={title}
      onCancel={event => event.preventDefault()}
      onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}
    >
      <div className="m-alert" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="m-alert-body">
          <b>{title}</b>
          {message && <p>{message}</p>}
          {children}
        </div>
        <div className={'m-alert-actions' + (vertical ? ' is-vertical' : '')}>
          {buttons.map((button, i) => (
            <button
              key={button.label}
              ref={i === 0 ? first : undefined}
              type="button"
              className={button.destructive ? 'is-destructive' : button.primary ? 'is-primary' : undefined}
              onClick={button.onPress}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}
