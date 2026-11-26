import type { PollQuestion } from '@/content/poll-types';
import type { QuestionAnswerState } from '@/components/polls/poll-answer-state';
import type { PublishedQuestionOptions } from '@/lib/poll-question-options';
import {
  normalizeTrainingApiBaseUrl,
  resolveTrainingApiConfig,
} from '@/lib/training-api-config';

export interface PersistPollAnswerInput {
  pollSlug: string;
  sessionId: string;
  question: PollQuestion;
  answer: QuestionAnswerState;
}

export class PollApiError extends Error {
  readonly statusCode: number;
  /** API ``error`` body when present (for example ``question_not_open``). */
  readonly errorCode: string | null;

  constructor(message: string, statusCode: number, errorCode: string | null = null) {
    super(message);
    this.name = 'PollApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

export function resolvePollApiConfig():
  | { baseUrl: string; apiKey: string }
  | null {
  return resolveTrainingApiConfig();
}

export interface PollQuestionResultsBucket {
  label: string;
  count: number;
}

export interface PollQuestionResults {
  pollSlug: string;
  questionId: string;
  questionType: PollAggregatableQuestionType;
  totalResponses: number;
  buckets: PollQuestionResultsBucket[];
  responses?: string[];
}

export interface PollControlState {
  pollSlug: string;
  enabledQuestionIds: string[];
  questionOptions?: Record<string, PublishedQuestionOptions>;
  updatedAt?: string;
}

export interface PersistPollControlStateInput {
  enabledQuestionIds: string[];
  questionOptions?: Record<string, PublishedQuestionOptions>;
}

export interface PollSessionAnswerItem {
  pollSlug?: string;
  sessionId?: string;
  questionId: string;
  questionType: PollQuestion['type'];
  selectedOption?: string;
  selectedOptions?: string[];
  booleanAnswer?: boolean;
  freeText?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PollSessionAnswers {
  pollSlug: string;
  sessionId: string;
  answers: PollSessionAnswerItem[];
}

export type PollAggregatableQuestionType =
  | 'select'
  | 'multiselect'
  | 'truefalse'
  | 'text'
  | 'email';

export interface FetchPollQuestionResultsInput {
  pollSlug: string;
  questionId: string;
  questionType: PollAggregatableQuestionType;
}

export async function fetchPollQuestionResults(
  input: FetchPollQuestionResultsInput,
): Promise<PollQuestionResults> {
  const config = resolvePollApiConfig();
  if (!config) {
    throw new PollApiError('Poll API is not configured', 0);
  }

  const params = new URLSearchParams({
    questionType: input.questionType,
  });
  const endpointPath = `${config.baseUrl}/v1/public/polls/${encodeURIComponent(input.pollSlug)}/questions/${encodeURIComponent(input.questionId)}/results?${params.toString()}`;

  const response = await fetch(endpointPath, {
    method: 'GET',
    headers: {
      'x-api-key': config.apiKey,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new PollApiError('Failed to load poll results', response.status);
  }

  return (await response.json()) as PollQuestionResults;
}

export async function fetchPollControlState(pollSlug: string): Promise<PollControlState> {
  const config = resolvePollApiConfig();
  if (!config) {
    throw new PollApiError('Poll API is not configured', 0);
  }

  const endpointPath = `${config.baseUrl}/v1/public/polls/${encodeURIComponent(pollSlug)}/control`;
  const response = await fetch(endpointPath, {
    method: 'GET',
    headers: {
      'x-api-key': config.apiKey,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new PollApiError('Failed to load poll control state', response.status);
  }

  return (await response.json()) as PollControlState;
}

export async function persistPollControlState(
  pollSlug: string,
  input: PersistPollControlStateInput,
): Promise<PollControlState> {
  const config = resolvePollApiConfig();
  if (!config) {
    throw new PollApiError('Poll API is not configured', 0);
  }

  const endpointPath = `${config.baseUrl}/v1/public/polls/${encodeURIComponent(pollSlug)}/control`;
  const body: Record<string, unknown> = {
    enabledQuestionIds: input.enabledQuestionIds,
  };
  if (input.questionOptions) {
    body.questionOptions = input.questionOptions;
  }
  const response = await fetch(endpointPath, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new PollApiError('Failed to update poll control state', response.status);
  }

  return (await response.json()) as PollControlState;
}

export async function fetchPollSessionAnswers(
  pollSlug: string,
  sessionId: string,
): Promise<PollSessionAnswers> {
  const config = resolvePollApiConfig();
  if (!config) {
    throw new PollApiError('Poll API is not configured', 0);
  }

  const params = new URLSearchParams({ sessionId });
  const endpointPath = `${config.baseUrl}/v1/public/polls/${encodeURIComponent(pollSlug)}/answers?${params.toString()}`;
  const response = await fetch(endpointPath, {
    method: 'GET',
    headers: {
      'x-api-key': config.apiKey,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new PollApiError('Failed to load poll session answers', response.status);
  }

  return (await response.json()) as PollSessionAnswers;
}

export async function persistPollAnswer(
  input: PersistPollAnswerInput,
): Promise<void> {
  const config = resolvePollApiConfig();
  if (!config) {
    throw new PollApiError('Poll API is not configured', 0);
  }

  const endpointPath = `${config.baseUrl}/v1/public/polls/${encodeURIComponent(input.pollSlug)}/answers`;
  const body = buildPersistBody(input);

  const response = await fetch(endpointPath, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorCode = await readPollApiErrorCode(response);
    throw new PollApiError('Failed to persist poll answer', response.status, errorCode);
  }
}

async function readPollApiErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

export function buildPersistBody(input: PersistPollAnswerInput): Record<string, unknown> {
  const base = {
    pollSlug: input.pollSlug,
    sessionId: input.sessionId,
    questionId: input.question.id,
    questionType: input.question.type,
  };

  if (input.question.type === 'select') {
    return {
      ...base,
      selectedOption: input.answer.selectedOption.trim(),
    };
  }

  if (input.question.type === 'multiselect') {
    return {
      ...base,
      selectedOptions: input.answer.selectedOptions.map((option) => option.trim()),
    };
  }

  if (input.question.type === 'truefalse') {
    return {
      ...base,
      booleanAnswer: input.answer.trueFalseValue,
    };
  }

  return {
    ...base,
    freeText: input.answer.freeText.trim(),
  };
}

export { normalizeTrainingApiBaseUrl as normalizePollApiBaseUrl };
