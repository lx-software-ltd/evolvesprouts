import { clampAdminListLimit } from './admin-list-limit';
import { ensureFreshTokens } from './auth';
import { adminApiRequest } from './api-admin-client';
import { getApiBaseUrl } from './config';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type AdminPollSummary = ApiSchemas['AdminPollSummary'];
export type AdminPollAnswerRow = ApiSchemas['AdminPollAnswerRow'];
export type AdminPollClearAnswersResponse = ApiSchemas['AdminPollClearAnswersResponse'];

function parsePollSummary(value: unknown): AdminPollSummary {
  const row = isRecord(value) ? value : {};
  return {
    pollSlug: typeof row.pollSlug === 'string' ? row.pollSlug : '',
    answerCount: typeof row.answerCount === 'number' ? row.answerCount : 0,
  };
}

function parsePollAnswerRow(value: unknown): AdminPollAnswerRow {
  const row = isRecord(value) ? value : {};
  const parsed: AdminPollAnswerRow = {
    pollSlug: typeof row.pollSlug === 'string' ? row.pollSlug : '',
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
    questionId: typeof row.questionId === 'string' ? row.questionId : '',
    questionType:
      row.questionType === 'select' ||
      row.questionType === 'multiselect' ||
      row.questionType === 'truefalse' ||
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
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );
  }
  if (typeof row.booleanAnswer === 'boolean') {
    parsed.booleanAnswer = row.booleanAnswer;
  }
  if (typeof row.freeText === 'string') {
    parsed.freeText = row.freeText;
  }
  return parsed;
}

export async function listAdminPolls(signal?: AbortSignal): Promise<AdminPollSummary[]> {
  const payload = await adminApiRequest<ApiSchemas['AdminPollListResponse']>({
    endpointPath: '/v1/admin/polls',
    method: 'GET',
    signal,
  });
  return Array.isArray(payload.items) ? payload.items.map((item) => parsePollSummary(item)) : [];
}

export async function listAdminPollAnswers(
  pollSlug: string,
  params: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}
): Promise<{ items: AdminPollAnswerRow[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }
  if (typeof params.limit === 'number') {
    query.set('limit', `${clampAdminListLimit(params.limit)}`);
  }
  const queryString = query.toString();
  const payload = await adminApiRequest<ApiSchemas['AdminPollAnswerListResponse']>({
    endpointPath: `/v1/admin/polls/${encodeURIComponent(pollSlug)}/answers${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
    signal: params.signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((item) => parsePollAnswerRow(item)) : [],
    nextCursor: typeof payload.next_cursor === 'string' ? payload.next_cursor : null,
  };
}

export async function clearAdminPollAnswers(pollSlug: string): Promise<AdminPollClearAnswersResponse> {
  const payload = await adminApiRequest<ApiSchemas['AdminPollClearAnswersResponse']>({
    endpointPath: `/v1/admin/polls/${encodeURIComponent(pollSlug)}/answers`,
    method: 'DELETE',
  });
  return {
    pollSlug: typeof payload.pollSlug === 'string' ? payload.pollSlug : pollSlug,
    deletedCount: typeof payload.deletedCount === 'number' ? payload.deletedCount : 0,
  };
}

export async function exportAdminPollAnswersCsv(pollSlug: string): Promise<Blob> {
  const tokens = await ensureFreshTokens();
  if (!tokens) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const response = await fetch(
    `${getApiBaseUrl()}/v1/admin/polls/${encodeURIComponent(pollSlug)}/answers/export`,
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

export function formatPollAnswerValue(row: AdminPollAnswerRow): string {
  if (typeof row.selectedOption === 'string' && row.selectedOption.trim()) {
    return row.selectedOption;
  }
  if (Array.isArray(row.selectedOptions) && row.selectedOptions.length > 0) {
    return row.selectedOptions.join('; ');
  }
  if (typeof row.booleanAnswer === 'boolean') {
    return row.booleanAnswer ? 'True' : 'False';
  }
  if (typeof row.freeText === 'string' && row.freeText.trim()) {
    return row.freeText;
  }
  return '—';
}
