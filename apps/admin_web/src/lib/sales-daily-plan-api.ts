import { adminApiRequest } from './api-admin-client';
import { asNullableString } from './api-payload';
import { isRecord } from './type-guards';

import type {
  SalesDailyPlan,
  SalesDailyPlanJob,
  SalesDailyPlanJobStatus,
  SalesDailyPlanMemoryEntry,
  SalesDailyPlanSnapshot,
} from '@/types/sales-daily-plan';

function parsePriority(value: unknown): SalesDailyPlan['priorities'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = asNullableString(value.title)?.trim() ?? '';
  if (!title) {
    return null;
  }
  return {
    title,
    why: asNullableString(value.why) ?? '',
    action: asNullableString(value.action) ?? '',
    leadId: asNullableString(value.lead_id),
  };
}

function parseOutreach(value: unknown): SalesDailyPlan['outreach'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    channel: asNullableString(value.channel) ?? 'unknown',
    leadId: asNullableString(value.lead_id),
    messageExcerpt: asNullableString(value.message_excerpt) ?? '',
    draftReply: asNullableString(value.draft_reply) ?? '',
    rationale: asNullableString(value.rationale) ?? '',
  };
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry.length > 0);
}

export function parseSalesDailyPlan(value: unknown): SalesDailyPlan | null {
  if (!isRecord(value)) {
    return null;
  }
  const staleReasons = Array.isArray(value.stale_reasons)
    ? value.stale_reasons.map((entry) => String(entry)).filter(Boolean)
    : [];
  return {
    id: asNullableString(value.id) ?? '',
    focus: asNullableString(value.focus) ?? '',
    priorities: Array.isArray(value.priorities)
      ? value.priorities
          .map((entry) => parsePriority(entry))
          .filter((entry): entry is SalesDailyPlan['priorities'][number] => entry !== null)
      : [],
    outreach: Array.isArray(value.outreach)
      ? value.outreach
          .map((entry) => parseOutreach(entry))
          .filter((entry): entry is SalesDailyPlan['outreach'][number] => entry !== null)
      : [],
    productFocus: asNullableString(value.product_focus) ?? '',
    offerRefinements: parseStringList(value.offer_refinements),
    risks: parseStringList(value.risks),
    generatedAt: asNullableString(value.generated_at),
    generatedBy: asNullableString(value.generated_by),
    model: asNullableString(value.model),
    operatorInput: asNullableString(value.operator_input),
    conversationWatermarkAt: asNullableString(value.conversation_watermark_at),
    pipelineWatermarkAt: asNullableString(value.pipeline_watermark_at),
    isStale: Boolean(value.is_stale),
    staleReasons,
    staleAfter: asNullableString(value.stale_after),
    latestMessageAt: asNullableString(value.latest_message_at),
    latestPipelineAt: asNullableString(value.latest_pipeline_at),
  };
}

function parseSalesDailyPlanJob(value: unknown): SalesDailyPlanJob | null {
  if (!isRecord(value)) {
    return null;
  }
  const statusRaw = asNullableString(value.status);
  const status = (statusRaw ?? 'pending') as SalesDailyPlanJobStatus;
  return {
    id: asNullableString(value.id) ?? '',
    status,
    errorMessage: asNullableString(value.error_message),
    operatorInput: asNullableString(value.operator_input),
    planId: asNullableString(value.plan_id),
    createdAt: asNullableString(value.created_at),
    startedAt: asNullableString(value.started_at),
    finishedAt: asNullableString(value.finished_at),
    updatedAt: asNullableString(value.updated_at),
    queueWaitMs: typeof value.queue_wait_ms === 'number' ? value.queue_wait_ms : null,
    durationMs: typeof value.duration_ms === 'number' ? value.duration_ms : null,
    plan: parseSalesDailyPlan(value.plan),
  };
}

export function parseSalesDailyPlanMemoryEntry(
  value: unknown,
): SalesDailyPlanMemoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asNullableString(value.id)?.trim() ?? '';
  if (!id) {
    return null;
  }
  return {
    id,
    generatedAt: asNullableString(value.generated_at),
    focus: asNullableString(value.focus) ?? '',
    productFocus: asNullableString(value.product_focus) ?? '',
    operatorInput: asNullableString(value.operator_input),
  };
}

export function parseSalesDailyPlanSnapshot(value: unknown): SalesDailyPlanSnapshot {
  if (!isRecord(value)) {
    return { plan: null, memory: [] };
  }
  const memory = Array.isArray(value.memory)
    ? value.memory
        .map((entry) => parseSalesDailyPlanMemoryEntry(entry))
        .filter((entry): entry is SalesDailyPlanMemoryEntry => entry !== null)
    : [];
  return {
    plan: parseSalesDailyPlan(value.plan),
    memory,
  };
}

export async function fetchSalesDailyPlan(): Promise<SalesDailyPlanSnapshot> {
  const payload = await adminApiRequest<unknown>({
    endpointPath: '/v1/admin/leads/daily-plan',
    method: 'GET',
  });
  return parseSalesDailyPlanSnapshot(payload);
}

export async function enqueueSalesDailyPlanJob(
  operatorInput?: string,
): Promise<SalesDailyPlanJob> {
  const trimmed = operatorInput?.trim() ?? '';
  const payload = await adminApiRequest<{ job?: unknown }>({
    endpointPath: '/v1/admin/leads/daily-plan',
    method: 'POST',
    body: { operator_input: trimmed || null },
    expectedSuccessStatuses: [202],
  });
  const job = parseSalesDailyPlanJob(payload.job);
  if (!job) {
    throw new Error('Daily plan job response was empty.');
  }
  return job;
}

export async function fetchSalesDailyPlanJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<SalesDailyPlanJob> {
  const payload = await adminApiRequest<{ job?: unknown }>({
    endpointPath: `/v1/admin/leads/daily-plan/jobs/${jobId}`,
    method: 'GET',
    expectedSuccessStatuses: [200],
    signal,
  });
  const job = parseSalesDailyPlanJob(payload.job);
  if (!job) {
    throw new Error('Daily plan job response was empty.');
  }
  return job;
}

export async function pollSalesDailyPlanJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<SalesDailyPlanJob> {
  const maxMs = 5 * 60 * 1000;
  const started = Date.now();
  let delayMs = 1000;
  while (Date.now() - started < maxMs) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const job = await fetchSalesDailyPlanJob(jobId, signal);
    if (job.status === 'succeeded') {
      return job;
    }
    if (job.status === 'failed') {
      throw new Error(job.errorMessage?.trim() || 'Daily plan generation failed.');
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
    delayMs = Math.min(Math.floor(delayMs * 1.25), 5000);
  }
  throw new Error(
    'Daily plan is taking longer than expected; refresh the dashboard to check again.',
  );
}

export async function resetSalesDailyPlanMemory(): Promise<void> {
  await adminApiRequest({
    endpointPath: '/v1/admin/leads/daily-plan',
    method: 'DELETE',
    expectedSuccessStatuses: [204],
  });
}
