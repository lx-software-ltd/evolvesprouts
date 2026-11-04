import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPublicCrmApiClient } from '@/lib/crm-api-client';
import {
  fetchEventsPayload,
  MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
} from '@/lib/events-data';
import { fetchMyBestAuntieCohortsForPage } from '@/lib/fetch-my-best-auntie-cohorts';
import { reportInternalError } from '@/lib/internal-error-reporting';
import trainingCoursesFixture from '../fixtures/my-best-auntie-training-courses.json';

vi.mock('@/lib/crm-api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm-api-client')>(
    '@/lib/crm-api-client',
  );
  return {
    ...actual,
    createPublicCrmApiClient: vi.fn(),
  };
});

vi.mock('@/lib/events-data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events-data')>(
    '@/lib/events-data',
  );
  return {
    ...actual,
    fetchEventsPayload: vi.fn(),
  };
});

vi.mock('@/lib/internal-error-reporting', () => ({
  reportInternalError: vi.fn(),
}));

const mockedCreateClient = vi.mocked(createPublicCrmApiClient);
const mockedFetchEventsPayload = vi.mocked(fetchEventsPayload);
const mockedReportInternalError = vi.mocked(reportInternalError);

afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchMyBestAuntieCohortsForPage', () => {
  it('returns normalized cohorts from the training-course calendar', async () => {
    mockedCreateClient.mockReturnValue({} as ReturnType<typeof createPublicCrmApiClient>);
    mockedFetchEventsPayload.mockResolvedValue(
      trainingCoursesFixture as Awaited<ReturnType<typeof fetchEventsPayload>>,
    );

    const cohorts = await fetchMyBestAuntieCohortsForPage({
      reportContext: 'helper-training-hong-kong',
      locale: 'en',
    });

    expect(mockedFetchEventsPayload).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(AbortSignal),
      {
        serviceKey: MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
        serviceType: 'training_course',
      },
    );
    expect(cohorts.map((cohort) => cohort.slug).sort()).toEqual(
      trainingCoursesFixture.data.map((cohort) => cohort.slug).sort(),
    );
    expect(mockedReportInternalError).not.toHaveBeenCalled();
  });

  it('reports and returns an empty list when the CRM client is not configured', async () => {
    mockedCreateClient.mockReturnValue(null);

    const cohorts = await fetchMyBestAuntieCohortsForPage({
      reportContext: 'helper-training-hong-kong',
      locale: 'zh-HK',
    });

    expect(cohorts).toEqual([]);
    expect(mockedFetchEventsPayload).not.toHaveBeenCalled();
    expect(mockedReportInternalError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'helper-training-hong-kong-no-crm-client',
        metadata: { locale: 'zh-HK', reason: 'missing_public_crm_client' },
      }),
    );
  });

  it('reports fetch failures under the page context and degrades to an empty list', async () => {
    mockedCreateClient.mockReturnValue({} as ReturnType<typeof createPublicCrmApiClient>);
    const failure = new Error('calendar unavailable');
    mockedFetchEventsPayload.mockRejectedValue(failure);

    const cohorts = await fetchMyBestAuntieCohortsForPage({
      reportContext: 'my-best-auntie-training-course',
      locale: 'en',
    });

    expect(cohorts).toEqual([]);
    expect(mockedReportInternalError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'my-best-auntie-training-course-calendar-fetch',
        error: failure,
        metadata: { locale: 'en' },
      }),
    );
  });
});
