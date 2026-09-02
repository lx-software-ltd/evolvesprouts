import { clampAdminListLimit } from './admin-list-limit';
import { ensureFreshTokens } from './auth';
import { adminApiRequest } from './api-admin-client';
import { getApiBaseUrl } from './config';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type AdminFormSummary = ApiSchemas['AdminFormSummary'];
export type AdminFormAnswerRow = ApiSchemas['AdminFormAnswerRow'];
export type AdminFormClearAnswersResponse = ApiSchemas['AdminFormClearAnswersResponse'];

function parseFormSummary(value: unknown): AdminFormSummary {
  const row = isRecord(value) ? value : {};
  return {
    formSlug: typeof row.formSlug === 'string' ? row.formSlug : '',
    answerCount: typeof row.answerCount === 'number' ? row.answerCount : 0,
  };
}

function parseFormAnswerRow(value: unknown): AdminFormAnswerRow {
  const row = isRecord(value) ? value : {};
  const parsed: AdminFormAnswerRow = {
    formSlug: typeof row.formSlug === 'string' ? row.formSlug : '',
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
    questionId: typeof row.questionId === 'string' ? row.questionId : '',
    questionType:
      row.questionType === 'select' ||
      row.questionType === 'multiselect' ||
      row.questionType === 'rating' ||
      row.questionType === 'segmented' ||
      row.questionType === 'consent' ||
      row.questionType === 'text' ||
      row.questionType === 'email'
        ? row.questionType
        : 'text',
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
  };
  if (typeof row.selectedOption === 'string') {
    parsed.selectedOption = row.selectedOption;
  }
  if (Array.isArray(row.selectedOptions)) {
    parsed.selectedOptions = row.selectedOptions.filter(
      (option): option is string => typeof option === 'string' && option.trim().length > 0
    );
  }
  if (typeof row.ratingValue === 'number' && Number.isFinite(row.ratingValue)) {
    parsed.ratingValue = row.ratingValue;
  }
  if (typeof row.booleanAnswer === 'boolean') {
    parsed.booleanAnswer = row.booleanAnswer;
  }
  if (typeof row.freeText === 'string') {
    parsed.freeText = row.freeText;
  }
  return parsed;
}

export async function listAdminForms(signal?: AbortSignal): Promise<AdminFormSummary[]> {
  const payload = await adminApiRequest<ApiSchemas['AdminFormListResponse']>({
    endpointPath: '/v1/admin/forms',
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((item) => parseFormSummary(item)) : [];
}

export async function listAdminFormAnswers(
  formSlug: string,
  params: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}
): Promise<{ items: AdminFormAnswerRow[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }
  if (typeof params.limit === 'number') {
    query.set('limit', `${clampAdminListLimit(params.limit)}`);
  }
  const queryString = query.toString();
  const payload = await adminApiRequest<ApiSchemas['AdminFormAnswerListResponse']>({
    endpointPath: `/v1/admin/forms/${encodeURIComponent(formSlug)}/answers${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal: params.signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((item) => parseFormAnswerRow(item)) : [],
    nextCursor: typeof payload.next_cursor === 'string' ? payload.next_cursor : null,
  };
}

export async function clearAdminFormAnswers(
  formSlug: string
): Promise<AdminFormClearAnswersResponse> {
  const payload = await adminApiRequest<ApiSchemas['AdminFormClearAnswersResponse']>({
    endpointPath: `/v1/admin/forms/${encodeURIComponent(formSlug)}/answers`,
    method: 'DELETE',
  });
  return {
    formSlug: typeof payload.formSlug === 'string' ? payload.formSlug : formSlug,
    deletedCount: typeof payload.deletedCount === 'number' ? payload.deletedCount : 0,
  };
}

export async function exportAdminFormAnswersCsv(formSlug: string): Promise<Blob> {
  const tokens = await ensureFreshTokens();
  if (!tokens) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const response = await fetch(
    `${getApiBaseUrl()}/v1/admin/forms/${encodeURIComponent(formSlug)}/answers/export`,
    {
      method: 'GET',
      headers: {
        Accept: 'text/csv',
        Authorization: `Bearer ${tokens.idToken}`,
      },
    }
  );
  if (!response.ok) {
    throw new Error(`CSV export failed with status ${response.status}.`);
  }
  return response.blob();
}

export function formatFormAnswerValue(row: AdminFormAnswerRow): string {
  if (typeof row.ratingValue === 'number') {
    return String(row.ratingValue);
  }
  if (typeof row.selectedOption === 'string' && row.selectedOption.trim()) {
    return row.selectedOption;
  }
  if (Array.isArray(row.selectedOptions) && row.selectedOptions.length > 0) {
    return row.selectedOptions.join('; ');
  }
  if (typeof row.booleanAnswer === 'boolean') {
    const consentBase = row.booleanAnswer ? 'yes' : 'no';
    if (row.questionType === 'consent' && typeof row.freeText === 'string' && row.freeText.trim()) {
      return `${consentBase}; ${row.freeText.trim()}`;
    }
    return consentBase;
  }
  if (typeof row.freeText === 'string' && row.freeText.trim()) {
    return row.freeText;
  }
  return '—';
}
