import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  readBookingDeepLinkFromSearch,
  type BookingDeepLinkQuery,
} from '@/lib/booking-deep-link';

interface UseBookingAutoOpenFromQueryOptions {
  bookingSystem: string;
  canOpen: boolean;
  onOpen: () => void;
}

function subscribeToPageSearch(onStoreChange: () => void): () => void {
  window.addEventListener('popstate', onStoreChange);
  return () => {
    window.removeEventListener('popstate', onStoreChange);
  };
}

function readPageSearchSnapshot(): string {
  return window.location.search;
}

function readServerPageSearchSnapshot(): string {
  return '';
}

/**
 * Booking query from the page URL. The server snapshot is empty so the first
 * hydration render matches SSR; React then applies the client search before effects.
 */
export function useBookingPageSearch(): BookingDeepLinkQuery {
  const search = useSyncExternalStore(
    subscribeToPageSearch,
    readPageSearchSnapshot,
    readServerPageSearchSnapshot,
  );
  return readBookingDeepLinkFromSearch(search);
}

export function useBookingAutoOpenFromQuery({
  bookingSystem,
  canOpen,
  onOpen,
}: UseBookingAutoOpenFromQueryOptions) {
  const hasOpenedBookingModalFromQueryRef = useRef(false);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const queryLink = readBookingDeepLinkFromSearch(window.location.search);
    if (queryLink.bookingSystem !== bookingSystem) {
      return;
    }
    if (hasOpenedBookingModalFromQueryRef.current) {
      return;
    }
    if (!canOpen) {
      return;
    }

    hasOpenedBookingModalFromQueryRef.current = true;
    const openModalTimerId = window.setTimeout(() => {
      onOpenRef.current();
    }, 0);

    return () => {
      window.clearTimeout(openModalTimerId);
    };
  }, [bookingSystem, canOpen]);
}
