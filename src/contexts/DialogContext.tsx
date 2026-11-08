'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { SystemAlert } from '../components/SystemAlert';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for deleting or discarding. */
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  confirmLabel?: string;
  cancelLabel?: string;
}

interface DialogContextValue {
  /** The app's replacement for window.confirm: resolves true when the person confirms. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** The app's replacement for window.prompt: resolves the typed text, or null when cancelled. */
  prompt: (options: PromptOptions) => Promise<string | null>;
}

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);

  const settle = useCallback((value: boolean | string | null) => {
    const active = current.current;
    if (!active) return;
    current.current = null;
    setPending(null);
    if (active.kind === 'confirm') active.resolve(value === true);
    else active.resolve(typeof value === 'string' ? value : null);
  }, []);

  const open = useCallback((next: Pending) => {
    // Only one alert at a time: a new request cancels the one still showing.
    settle(null);
    current.current = next;
    setPending(next);
  }, [settle]);

  const confirm = useCallback((options: ConfirmOptions) =>
    new Promise<boolean>(resolve => open({ kind: 'confirm', options, resolve })), [open]);
  const prompt = useCallback((options: PromptOptions) =>
    new Promise<string | null>(resolve => open({ kind: 'prompt', options, resolve })), [open]);

  // Leaving the app with an alert open counts as cancelling it.
  useEffect(() => () => settle(null), [settle]);

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  const dismiss = useCallback(() => settle(null), [settle]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {pending?.kind === 'confirm' && (
        <SystemAlert
          title={pending.options.title}
          message={pending.options.message}
          onDismiss={dismiss}
          buttons={[
            { label: pending.options.cancelLabel ?? 'Cancel', onPress: dismiss },
            {
              label: pending.options.confirmLabel ?? 'OK',
              destructive: pending.options.destructive,
              primary: !pending.options.destructive,
              onPress: () => settle(true),
            },
          ]}
        />
      )}
      {pending?.kind === 'prompt' && (
        <PromptAlert options={pending.options} onCancel={dismiss} onSubmit={text => settle(text)} />
      )}
    </DialogContext.Provider>
  );
}

function PromptAlert({ options, onCancel, onSubmit }: { options: PromptOptions; onCancel: () => void; onSubmit: (text: string) => void }) {
  const [text, setText] = useState(options.defaultValue ?? '');
  return (
    <SystemAlert
      title={options.title}
      message={options.message}
      onDismiss={onCancel}
      buttons={[
        { label: options.cancelLabel ?? 'Cancel', onPress: onCancel },
        { label: options.confirmLabel ?? 'OK', primary: true, onPress: () => onSubmit(text) },
      ]}
    >
      <input
        data-autofocus
        className="m-alert-input"
        aria-label={options.title}
        value={text}
        placeholder={options.placeholder}
        inputMode={options.inputMode}
        onChange={event => setText(event.target.value)}
        onFocus={event => event.currentTarget.select()}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onSubmit(text); } }}
      />
    </SystemAlert>
  );
}

export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used within a DialogProvider');
  return context;
}
