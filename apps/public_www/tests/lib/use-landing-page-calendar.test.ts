import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCrmApiGetCacheForTests } from '@/lib/crm-api-client';
import { publicCalendarFixture } from '../fixtures/public-calendar';
import * as eventsData from '@/lib/events-data';
import { useLandingPageCalendar } from '@/lib/use-landing-page-calendar';

const slug = 'easter-2026-montessori-play-coaching-workshop';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  clearCrmApiGetCacheForTests();
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.evolvesprouts.com/api');
  vi.stubEnv('NEXT_PUBLIC_WWW_CRM_API_KEY', 'public-crm-key');
});

describe('useLandingPageCalendar', () => {
  it('returns runtime-derived hero and booking after fetch resolves with newer payload', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(publicCalendarFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const initialHero = {
      title: 'SSR Title',
      categoryChips: ['Old'],
    };
    const initialBooking = {
      status: 'open' as const,
      bookingPayload: null,
    };

    const { result } = renderHook(() =>
      useLandingPageCalendar({
        slug,
        locale: 'en',
        initialHero,
        initialBooking,
        initialStructuredData: null,
      }),
    );

    await waitFor(() => {
      expect(result.current.heroEventContent?.title).toBe(
        'Easter 2026 Montessori Play Coaching Workshop',
      );
    });

    expect(result.current.heroEventContent?.categoryChips).toContain('Workshop');
    expect(result.current.bookingEventContent?.bookingPayload).not.toBeNull();
    expect(result.current.hasRefreshError).toBe(false);
  });

  it('returns runtime values when SSR initial values are null and fetch resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(publicCalendarFixture), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const { result } = renderHook(() =>
      useLandingPageCalendar({
        slug,
        locale: 'en',
        initialHero: null,
        initialBooking: null,
        initialStructuredData: null,
      }),
    );

    await waitFor(() => {
      expect(result.current.bookingEventContent?.bookingPayload).not.toBeNull();
    });
  });

  it('falls back to initial values and sets hasRefreshError on non-abort fetch failure', async () => {
    const initialHero = { title: 'SSR', categoryChips: [] };
    const initialBooking = {
      status: 'open' as const,
      bookingPayload: null,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    const { result } = renderHook(() =>
      useLandingPageCalendar({
        slug,
        locale: 'en',
        initialHero,
        initialBooking,
        initialStructuredData: null,
      }),
    );

    await waitFor(() => {
      expect(result.current.hasRefreshError).toBe(true);
    });

    expect(result.current.heroEventContent).toEqual(initialHero);
    expect(result.current.bookingEventContent).toEqual(initialBooking);
  });

  it('does not update state after unmount when fetch is aborted', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise));

    const { result, unmount } = renderHook(() =>
      useLandingPageCalendar({
        slug,
        locale: 'en',
        initialHero: null,
        initialBooking: null,
        initialStructuredData: null,
      }),
    );

    unmount();

    resolveFetch(
      new Response(JSON.stringify(publicCalendarFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await new Promise((r) => {
      setTimeout(r, 0);
    });

    expect(result.current.heroEventContent).toBeNull();
  });

  it('delegates to fetchEventsPayload with slug param', async () => {
    const spy = vi
      .spyOn(eventsData, 'fetchEventsPayload')
      .mockResolvedValue(publicCalendarFixture);

    const { result } = renderHook(() =>
      useLandingPageCalendar({
        slug,
        locale: 'zh-HK',
        initialHero: null,
        initialBooking: null,
        initialStructuredData: null,
      }),
    );

    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });

    const firstCall = spy.mock.calls[0];
    expect(firstCall?.[2]).toEqual({ slug });

    await waitFor(() => {
      expect(result.current.bookingEventContent?.bookingPayload).not.toBeNull();
    });
  });
});
