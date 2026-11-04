import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import enContent from '@/content/en.json';
import easterWorkshopContent from '@/content/landing-pages/easter-2026-montessori-play-coaching-workshop.json';
import helperTrainingContent from '@/content/landing-pages/helper-training-hong-kong.json';
const mockFetchLandingPageCalendarPayload = vi.hoisted(() => vi.fn());
const mockFetchMyBestAuntieCohortsForPage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/fetch-my-best-auntie-cohorts', () => ({
  fetchMyBestAuntieCohortsForPage: mockFetchMyBestAuntieCohortsForPage,
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
}));

vi.mock('@/lib/events-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events-data')>();
  return {
    ...actual,
    fetchLandingPageCalendarPayload: mockFetchLandingPageCalendarPayload,
  };
});

vi.mock('@/components/shared/structured-data-script', () => ({
  StructuredDataScript: () => null,
}));

vi.mock('@/lib/locale-page', () => ({
  resolveLocalePageContext: vi.fn(async () => ({
    locale: 'en' as const,
    content: enContent,
  })),
  getMenuLabel: vi.fn(() => 'Home'),
}));

vi.mock('@/lib/structured-data', () => ({
  buildBreadcrumbSchema: vi.fn(() => ({})),
}));

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mockFetchLandingPageCalendarPayload.mockClear();
});

describe('LandingPageRoute', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.evolvesprouts.com/www');
    vi.stubEnv('NEXT_PUBLIC_WWW_CRM_API_KEY', 'public-crm-key');
  });

  it('derives null hero, booking, and structured data from an empty calendar payload', async () => {
    mockFetchLandingPageCalendarPayload.mockResolvedValue({
      payload: { status: 'success', data: [] },
      lastError: null,
    });

    const { default: LandingPageRoute } = await import('@/app/[locale]/[slug]/page');
    const tree = await LandingPageRoute({
      params: Promise.resolve({
        locale: 'en',
        slug: 'easter-2026-montessori-play-coaching-workshop',
      }),
    });

    expect(mockFetchLandingPageCalendarPayload).toHaveBeenCalledWith({
      slug: 'easter-2026-montessori-play-coaching-workshop',
    });

    expect(isValidElement(tree)).toBe(true);
    const children = (tree as { props?: { children?: ReactNode } }).props?.children;
    const flatChildren = Children.toArray(children);
    const landingPageEl = flatChildren.find(
      (node) =>
        isValidElement(node) &&
        (node.props as { slug?: string }).slug ===
          'easter-2026-montessori-play-coaching-workshop',
    );
    expect(isValidElement(landingPageEl)).toBe(true);
    expect((landingPageEl as { props: Record<string, unknown> }).props).toMatchObject({
      heroEventContent: null,
      bookingEventContent: null,
      pageContent: easterWorkshopContent.en,
    });
    expect(mockFetchMyBestAuntieCohortsForPage).not.toHaveBeenCalled();
  });

  it('loads My Best Auntie cohorts instead of a landing-page calendar for helper-training-hong-kong', async () => {
    const cohorts = [{ slug: 'my-best-auntie-1-3-apr-26' }];
    mockFetchMyBestAuntieCohortsForPage.mockResolvedValue(cohorts);

    const { default: LandingPageRoute } = await import('@/app/[locale]/[slug]/page');
    const tree = await LandingPageRoute({
      params: Promise.resolve({ locale: 'en', slug: 'helper-training-hong-kong' }),
    });

    expect(mockFetchLandingPageCalendarPayload).not.toHaveBeenCalled();
    expect(mockFetchMyBestAuntieCohortsForPage).toHaveBeenCalledWith({
      reportContext: 'helper-training-hong-kong',
      locale: 'en',
    });

    const children = (tree as { props?: { children?: ReactNode } }).props?.children;
    const pageEl = Children.toArray(children).find(
      (node) =>
        isValidElement(node) && (node.props as { cohorts?: unknown }).cohorts === cohorts,
    );
    expect(isValidElement(pageEl)).toBe(true);
    expect((pageEl as { props: Record<string, unknown> }).props).toMatchObject({
      locale: 'en',
      pagePath: '/helper-training-hong-kong',
      pageContent: helperTrainingContent.en,
    });
  });
});
