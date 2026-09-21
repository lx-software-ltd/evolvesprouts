'use client';

import { useEffect, useMemo, useState } from 'react';

import type { Locale } from '@/content';
import {
  createPublicCrmApiClient,
  isAbortRequestError,
} from '@/lib/crm-api-client';
import {
  CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS,
  fetchEventsPayload,
  getLandingPageBookingEventContentFromPayload,
  getLandingPageHeroEventContentFromPayload,
  getLandingPageStructuredDataContentFromPayload,
  type LandingPageBookingEventContent,
  type LandingPageHeroEventContent,
  type LandingPageStructuredDataContent,
} from '@/lib/events-data';

export interface UseLandingPageCalendarParams {
  slug: string;
  locale: Locale;
  initialHero: LandingPageHeroEventContent | null;
  initialBooking: LandingPageBookingEventContent | null;
  initialStructuredData: LandingPageStructuredDataContent | null;
}

export interface UseLandingPageCalendarResult {
  heroEventContent: LandingPageHeroEventContent | null;
  bookingEventContent: LandingPageBookingEventContent | null;
  structuredDataContent: LandingPageStructuredDataContent | null;
  isRefreshing: boolean;
  hasRefreshError: boolean;
}

export function useLandingPageCalendar({
  slug,
  locale,
  initialHero,
  initialBooking,
  initialStructuredData,
}: UseLandingPageCalendarParams): UseLandingPageCalendarResult {
  /** NEXT_PUBLIC_* inlined at build; empty deps = one client per mount tree. */
  const crmApiClient = useMemo(() => createPublicCrmApiClient(), []);

  const fetchCalendarEnabled = Boolean(crmApiClient) && slug !== 'book-a-free-call';

  const [heroEventContent, setHeroEventContent] = useState(initialHero);
  const [bookingEventContent, setBookingEventContent] = useState(initialBooking);
  const [structuredDataContent, setStructuredDataContent] = useState(initialStructuredData);
  const [isRefreshing, setIsRefreshing] = useState(() => fetchCalendarEnabled);
  const [hasRefreshError, setHasRefreshError] = useState(false);

  useEffect(() => {
    if (!fetchCalendarEnabled) {
      return;
    }

    const mountedRef = { current: true };
    const abortedDueToUnmountRef = { current: false };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, CALENDAR_PUBLIC_CLIENT_FETCH_TIMEOUT_MS);

    fetchEventsPayload(crmApiClient, controller.signal, { slug })
      .then((payload) => {
        if (!mountedRef.current) {
          return;
        }

        setHasRefreshError(false);
        setHeroEventContent(
          getLandingPageHeroEventContentFromPayload(payload, slug, locale),
        );
        setBookingEventContent(
          getLandingPageBookingEventContentFromPayload(payload, slug, locale),
        );
        setStructuredDataContent(
          getLandingPageStructuredDataContentFromPayload(payload, slug, locale),
        );
      })
      .catch((error) => {
        if (!mountedRef.current) {
          return;
        }

        if (isAbortRequestError(error)) {
          if (!abortedDueToUnmountRef.current) {
            setHasRefreshError(true);
          }
          return;
        }

        setHasRefreshError(true);
      })
      .finally(() => {
        if (mountedRef.current) {
          setIsRefreshing(false);
        }
      });

    return () => {
      abortedDueToUnmountRef.current = true;
      mountedRef.current = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [crmApiClient, fetchCalendarEnabled, locale, slug]);

  return {
    heroEventContent,
    bookingEventContent,
    structuredDataContent,
    isRefreshing,
    hasRefreshError,
  };
}
