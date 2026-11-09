'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDialog } from '../contexts/DialogContext';

export function useUnsavedChanges(hasUnsavedChanges: boolean) {
  const router = useRouter();
  const { confirm } = useDialog();
  // Set once the person agreed to leave, so the browser's unload prompt does not ask a second time.
  const leaving = useRef(false);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    leaving.current = false;

    // Reloading or closing the tab can only use the browser's own prompt; pages cannot show their own there.
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target && target.target !== '_self') return;
      let destination: URL;
      try {
        destination = new URL(target.href, window.location.origin);
        if (destination.origin === window.location.origin &&
            destination.pathname === window.location.pathname &&
            destination.search === window.location.search) {
          return;
        }
      } catch {
        return;
      }
      // Hold the navigation while the app's dialog asks, then follow the link ourselves.
      event.preventDefault();
      event.stopPropagation();
      void confirm({
        title: 'Leave this page?',
        message: 'Your unsaved changes will be lost.',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay',
        destructive: true,
      }).then(confirmed => {
        if (!confirmed) return;
        leaving.current = true;
        if (destination.origin === window.location.origin) {
          router.push(destination.pathname + destination.search + destination.hash);
        } else {
          window.location.assign(destination.href);
        }
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [hasUnsavedChanges, confirm, router]);
}
