import type { FormQuestion } from '@/content/form-types';
import type { FormAnswerState } from '@/components/forms/form-answer-state';
import { isQuestionRequired } from '@/content/form-types';
import {
  normalizeTrainingApiBaseUrl,
  resolveTrainingApiConfig,
} from '@/lib/training-api-config';

export interface PersistFormAnswerInput {
  formSlug: string;
  sessionId: string;
  question: FormQuestion;
  answer: FormAnswerState;
  contactId?: string | null;
}

export interface FormContactContextResponse {
  formSlug: string;
  contactId: string;
  placeholders: Record<string, string>;
}

export class FormApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'FormApiError';
    this.statusCode = statusCode;
  }
}

export function resolveFormApiConfig(): { baseUrl: string; apiKey: string } | null {
  return resolveTrainingApiConfig();
}

export async function persistFormAnswer(input: PersistFormAnswerInput): Promise<void> {
  const body = buildPersistBody(input);
  if (body === null) {
    return;
  }

  const config = resolveFormApiConfig();
  if (!config) {
    throw new FormApiError('Form API is not configured', 0);
  }

  const endpointPath = `${config.baseUrl}/v1/forms/${encodeURIComponent(input.formSlug)}/answers`;

  const response = await fetch(endpointPath, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new FormApiError('Failed to persist form answer', response.status);
  }
}

export function buildPersistBody(
  input: PersistFormAnswerInput,
): Record<string, unknown> | null {
  const contactId = input.contactId?.trim() ?? '';
  const base: Record<string, unknown> = {
    formSlug: input.formSlug,
    sessionId: input.sessionId,
    questionId: input.question.id,
    questionType: input.question.type,
  };
  if (contactId) {
    base.contactId = contactId;
  }

  if (input.question.type === 'select' || input.question.type === 'segmented') {
    const selectedOption = input.answer.selectedOption.trim();
    if (!selectedOption) {
      return null;
    }
    return {
      ...base,
      selectedOption,
    };
  }

  if (input.question.type === 'multiselect') {
    if (input.answer.selectedOptions.length === 0) {
      return null;
    }
    return {
      ...base,
      selectedOptions: input.answer.selectedOptions,
    };
  }

  if (input.question.type === 'rating') {
    if (input.answer.ratingValue === null) {
      return null;
    }
    return {
      ...base,
      ratingValue: input.answer.ratingValue,
    };
  }

  if (input.question.type === 'consent') {
    if (!isQuestionRequired(input.question) && input.answer.trueFalseValue !== true) {
      return null;
    }
    const payload: Record<string, unknown> = {
      ...base,
      booleanAnswer: input.answer.trueFalseValue === true,
    };
    const followUp = input.answer.freeText.trim();
    if (followUp) {
      payload.freeText = followUp;
    }
    return payload;
  }

  const freeText = input.answer.freeText.trim();
  if (!freeText) {
    return null;
  }

  return {
    ...base,
    freeText,
  };
}

export async function fetchFormContactContext(
  formSlug: string,
  contactId: string,
  signal?: AbortSignal,
): Promise<FormContactContextResponse> {
  const config = resolveFormApiConfig();
  if (!config) {
    throw new FormApiError('Form API is not configured', 0);
  }
  const params = new URLSearchParams({ contactId: contactId.trim() });
  const endpointPath = `${config.baseUrl}/v1/forms/${encodeURIComponent(formSlug)}/contact-context?${params.toString()}`;
  const response = await fetch(endpointPath, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'x-api-key': config.apiKey,
    },
    signal,
  });
  if (!response.ok) {
    throw new FormApiError('Failed to load form contact context', response.status);
  }
  const payload = (await response.json()) as FormContactContextResponse;
  const placeholders =
    payload && typeof payload.placeholders === 'object' && payload.placeholders !== null
      ? payload.placeholders
      : {};
  return {
    formSlug: typeof payload.formSlug === 'string' ? payload.formSlug : formSlug,
    contactId: typeof payload.contactId === 'string' ? payload.contactId : contactId,
    placeholders: Object.fromEntries(
      Object.entries(placeholders).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  };
}

export { normalizeTrainingApiBaseUrl as normalizeFormApiBaseUrl };
