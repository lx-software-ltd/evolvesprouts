'use client';

import { useEffect, useRef } from 'react';

/**
 * Run `select` once when `key` is non-empty and `isReady` is true.
 * The same key does not fire again (user can clear or change the selection).
 * A new key, or clearing `key` then setting it again, allows another select.
 */
export function useAutoSelectOnce(key: string, isReady: boolean, select: () => void): void {
  const appliedKeyRef = useRef('');

  useEffect(() => {
    if (!key) {
      appliedKeyRef.current = '';
      return;
    }
    if (!isReady || appliedKeyRef.current === key) {
      return;
    }
    appliedKeyRef.current = key;
    select();
  }, [key, isReady, select]);
}
