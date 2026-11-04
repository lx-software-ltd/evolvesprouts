import {
  createPublicCrmApiClient,
  isAbortRequestError,
} from '@/lib/crm-api-client';
import {
  CALENDAR_PUBLIC_FETCH_TIMEOUT_MS,
  MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
  type MyBestAuntieEventCohort,
  fetchEventsPayload,
  normalizeMyBestAuntieCohortsFromPayload,
} from '@/lib/events-data';
import { reportInternalError } from '@/lib/internal-error-reporting';

interface FetchMyBestAuntieCohortsOptions {
  /** Prefix for `reportInternalError` contexts, e.g. `my-best-auntie-training-course`. */
  reportContext: string;
  locale: string;
}

/**
 * Server-side cohort load shared by every page that embeds the My Best Auntie
 * booking section. Failures are reported and degrade to an empty list so the
 * page still renders and the client hook can refresh later.
 */
export async function fetchMyBestAuntieCohortsForPage({
  reportContext,
  locale,
}: FetchMyBestAuntieCohortsOptions): Promise<MyBestAuntieEventCohort[]> {
  const crmApiClient = createPublicCrmApiClient();
  if (!crmApiClient) {
    reportInternalError({
      context: `${reportContext}-no-crm-client`,
      error: new Error('CRM API client is not configured'),
      metadata: { locale, reason: 'missing_public_crm_client' },
    });
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CALENDAR_PUBLIC_FETCH_TIMEOUT_MS);
  try {
    const payload = await fetchEventsPayload(crmApiClient, controller.signal, {
      serviceKey: MY_BEST_AUNTIE_TRAINING_COURSE_CALENDAR_SERVICE_KEY,
      serviceType: 'training_course',
    });
    return normalizeMyBestAuntieCohortsFromPayload(payload);
  } catch (error) {
    if (!isAbortRequestError(error)) {
      reportInternalError({
        context: `${reportContext}-calendar-fetch`,
        error,
        metadata: { locale },
      });
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
