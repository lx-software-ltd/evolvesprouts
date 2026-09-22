import { adminApiRequest } from './api-admin-client';
import { asNullableString } from './api-payload';
import { isRecord } from './type-guards';

import type {
  SalesDailyPlan,
  SalesDailyPlanCompareStatus,
  SalesDailyPlanDroppedPriority,
  SalesDailyPlanFeedback,
  SalesDailyPlanInstruction,
  SalesDailyPlanInstructionScope,
  SalesDailyPlanItemKind,
  SalesDailyPlanJob,
  SalesDailyPlanJobStatus,
  SalesDailyPlanMemoryEntry,
  SalesDailyPlanPriorityKind,
  SalesDailyPlanQuestion,
  SalesDailyPlanSnooze,
  SalesDailyPlanSnapshot,
  SalesDailyPlanStaleCounts,
  SalesDailyPlanSuppressedItem,
  SalesDailyPlanSuppressedReason,
} from '@/types/sales-daily-plan';
import {
  salesDailyPlanOutreachKey,
  salesDailyPlanPriorityKey,
} from '@/types/sales-daily-plan';

const PRIORITY_KINDS = new Set<SalesDailyPlanPriorityKind>([
  'reply',
  'close',
  'chase_payment',
  'book',
  'offer',
]);
const FEEDBACK_VALUES = new Set<SalesDailyPlanFeedback>(['up', 'down', 'not_relevant']);

function parseFeedback(value: unknown): SalesDailyPlanFeedback | null {
  const text = asNullableString(value);
  if (!text || !FEEDBACK_VALUES.has(text as SalesDailyPlanFeedback)) {
    return null;
  }
  return text as SalesDailyPlanFeedback;
}

function parseKind(value: unknown): SalesDailyPlanPriorityKind | null {
  const text = asNullableString(value);
  if (!text || !PRIORITY_KINDS.has(text as SalesDailyPlanPriorityKind)) {
    return null;
  }
  return text as SalesDailyPlanPriorityKind;
}

function parseUrgency(value: unknown): number {
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

function parseDroppedPriority(value: unknown): SalesDailyPlanDroppedPriority | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = asNullableString(value.title)?.trim() ?? '';
  if (!title) {
    return null;
  }
  return {
    title,
    leadId: asNullableString(value.lead_id),
    invoiceId: asNullableString(value.invoice_id),
  };
}

function parseQuestion(value: unknown): SalesDailyPlanQuestion | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asNullableString(value.id)?.trim() ?? '';
  const question = asNullableString(value.question)?.trim() ?? '';
  if (!id || !question) {
    return null;
  }
  return {
    id,
    question,
    answer: asNullableString(value.answer) ?? '',
    askedBy: asNullableString(value.asked_by),
    askedAt: asNullableString(value.asked_at),
    model: asNullableString(value.model),
  };
}

function parseStaleCounts(value: unknown): SalesDailyPlanStaleCounts {
  if (!isRecord(value)) {
    return { newConversation: 0, pipelineChanged: 0, contactsChanged: 0 };
  }
  const asCount = (raw: unknown) => (typeof raw === 'number' && raw > 0 ? raw : 0);
  return {
    newConversation: asCount(value.new_conversation),
    pipelineChanged: asCount(value.pipeline_changed),
    contactsChanged: asCount(value.contacts_changed),
  };
}

function parsePriority(value: unknown): SalesDailyPlan['priorities'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = asNullableString(value.title)?.trim() ?? '';
  if (!title) {
    return null;
  }
  const leadId = asNullableString(value.lead_id);
  const invoiceId = asNullableString(value.invoice_id);
  const compareRaw = asNullableString(value.compare_status);
  const compareStatus =
    compareRaw === 'new' || compareRaw === 'carried'
      ? (compareRaw as SalesDailyPlanCompareStatus)
      : null;
  return {
    title,
    why: asNullableString(value.why) ?? '',
    action: asNullableString(value.action) ?? '',
    kind: parseKind(value.kind),
    urgency: parseUrgency(value.urgency),
    sources: parseStringList(value.sources),
    leadId,
    invoiceId,
    conversationId: asNullableString(value.conversation_id),
    channel: asNullableString(value.channel),
    assignedTo: asNullableString(value.assigned_to),
    itemKey: asNullableString(value.item_key)?.trim() || salesDailyPlanPriorityKey({
      title,
      leadId,
      invoiceId,
    }),
    done: Boolean(value.done),
    feedback: parseFeedback(value.feedback),
    snoozedUntil: asNullableString(value.snoozed_until),
    compareStatus,
    instructionId: asNullableString(value.instruction_id),
    fromInstruction: Boolean(value.from_instruction),
    resurfaced: Boolean(value.resurfaced),
  };
}

function parseOutreach(value: unknown): SalesDailyPlan['outreach'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const channel = asNullableString(value.channel) ?? 'unknown';
  const leadId = asNullableString(value.lead_id);
  const conversationId = asNullableString(value.conversation_id);
  const messageExcerpt = asNullableString(value.message_excerpt) ?? '';
  return {
    channel,
    leadId,
    conversationId,
    assignedTo: asNullableString(value.assigned_to),
    messageExcerpt,
    draftReply: asNullableString(value.draft_reply) ?? '',
    rationale: asNullableString(value.rationale) ?? '',
    itemKey: asNullableString(value.item_key)?.trim() || salesDailyPlanOutreachKey({
      channel,
      leadId,
      conversationId,
      messageExcerpt,
    }),
    feedback: parseFeedback(value.feedback),
    snoozedUntil: asNullableString(value.snoozed_until),
    savedDraftReply: asNullableString(value.saved_draft_reply),
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
    suppressedItems: parseSuppressedItems(value.suppressed_items),
    droppedPriorities: Array.isArray(value.dropped_priorities)
      ? value.dropped_priorities
          .map((entry) => parseDroppedPriority(entry))
          .filter((entry): entry is SalesDailyPlanDroppedPriority => entry !== null)
      : [],
    questions: Array.isArray(value.questions)
      ? value.questions
          .map((entry) => parseQuestion(entry))
          .filter((entry): entry is SalesDailyPlanQuestion => entry !== null)
      : [],
    generatedAt: asNullableString(value.generated_at),
    generatedBy: asNullableString(value.generated_by),
    generatedByName: asNullableString(value.generated_by_name),
    model: asNullableString(value.model),
    operatorInput: asNullableString(value.operator_input),
    conversationWatermarkAt: asNullableString(value.conversation_watermark_at),
    pipelineWatermarkAt: asNullableString(value.pipeline_watermark_at),
    isStale: Boolean(value.is_stale),
    staleReasons,
    staleCounts: parseStaleCounts(value.stale_counts),
    staleAfter: asNullableString(value.stale_after),
    latestMessageAt: asNullableString(value.latest_message_at),
    latestPipelineAt: asNullableString(value.latest_pipeline_at),
    latestContactAt: asNullableString(value.latest_contact_at),
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
    priorities: Array.isArray(value.priorities)
      ? value.priorities
          .map((entry) => parseDroppedPriority(entry))
          .filter((entry): entry is SalesDailyPlanDroppedPriority => entry !== null)
      : [],
  };
}

function parseSuppressedReason(value: unknown): SalesDailyPlanSuppressedReason | null {
  const text = asNullableString(value);
  if (text === 'done_today' || text === 'dismissed' || text === 'snoozed') {
    return text;
  }
  return null;
}

function parseSuppressedItems(value: unknown): SalesDailyPlanSuppressedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const title = asNullableString(entry.title)?.trim() ?? '';
    const itemKey = asNullableString(entry.item_key)?.trim() ?? '';
    const reason = parseSuppressedReason(entry.reason);
    if (!title || !itemKey || !reason) {
      return [];
    }
    const kind = asNullableString(entry.item_kind) === 'outreach' ? 'outreach' : 'priority';
    return [
      {
        title,
        itemKey,
        itemKind: kind,
        reason,
        leadId: asNullableString(entry.lead_id),
        invoiceId: asNullableString(entry.invoice_id),
      },
    ];
  });
}

function parseInstruction(value: unknown): SalesDailyPlanInstruction | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asNullableString(value.id)?.trim() ?? '';
  const text = asNullableString(value.text)?.trim() ?? '';
  const scopeRaw = asNullableString(value.scope);
  if (!id || !text || (scopeRaw !== 'today' && scopeRaw !== 'standing')) {
    return null;
  }
  const scope = scopeRaw as SalesDailyPlanInstructionScope;
  return {
    id,
    text,
    scope,
    activeUntil: asNullableString(value.active_until),
    createdBy: asNullableString(value.created_by),
    createdAt: asNullableString(value.created_at),
  };
}

export function parseSalesDailyPlanSnapshot(value: unknown): SalesDailyPlanSnapshot {
  if (!isRecord(value)) {
    return { plan: null, memory: [], instructions: [], job: null };
  }
  const memory = Array.isArray(value.memory)
    ? value.memory
        .map((entry) => parseSalesDailyPlanMemoryEntry(entry))
        .filter((entry): entry is SalesDailyPlanMemoryEntry => entry !== null)
    : [];
  const instructions = Array.isArray(value.instructions)
    ? value.instructions
        .map((entry) => parseInstruction(entry))
        .filter((entry): entry is SalesDailyPlanInstruction => entry !== null)
    : [];
  return {
    plan: parseSalesDailyPlan(value.plan),
    memory,
    instructions,
    job: parseSalesDailyPlanJob(value.job),
  };
}

export async function fetchSalesDailyPlan(options?: {
  compare?: boolean;
}): Promise<SalesDailyPlanSnapshot> {
  const query = options?.compare ? '?compare=true' : '';
  const payload = await adminApiRequest<unknown>({
    endpointPath: `/v1/admin/leads/daily-plan${query}`,
    method: 'GET',
  });
  return parseSalesDailyPlanSnapshot(payload);
}

export async function enqueueSalesDailyPlanJob(
  operatorInput?: string,
  operatorInputScope?: 'today' | 'standing',
): Promise<SalesDailyPlanJob> {
  const trimmed = operatorInput?.trim() ?? '';
  const payload = await adminApiRequest<{ job?: unknown }>({
    endpointPath: '/v1/admin/leads/daily-plan',
    method: 'POST',
    body: {
      operator_input: trimmed || null,
      ...(operatorInputScope ? { operator_input_scope: operatorInputScope } : {}),
    },
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

export async function upsertSalesDailyPlanPriorityCompletion(input: {
  planId: string;
  title: string;
  leadId?: string | null;
  invoiceId?: string | null;
  itemKey?: string | null;
  done: boolean;
}): Promise<SalesDailyPlan> {
  const payload = await adminApiRequest<{ plan?: unknown }>({
    endpointPath: '/v1/admin/leads/daily-plan/priority-completions',
    method: 'POST',
    body: {
      plan_id: input.planId,
      title: input.title,
      lead_id: input.leadId ?? null,
      invoice_id: input.invoiceId ?? null,
      item_key: input.itemKey ?? null,
      done: input.done,
    },
  });
  const plan = parseSalesDailyPlan(payload.plan);
  if (!plan) {
    throw new Error('Priority completion response was empty.');
  }
  return plan;
}

export async function upsertSalesDailyPlanItemAnnotation(input: {
  planId: string;
  itemKind: SalesDailyPlanItemKind;
  itemKey: string;
  feedback?: SalesDailyPlanFeedback | null;
  snooze?: SalesDailyPlanSnooze | null;
  draftReply?: string | null;
}): Promise<SalesDailyPlan> {
  const body: Record<string, unknown> = {
    plan_id: input.planId,
    item_kind: input.itemKind,
    item_key: input.itemKey,
  };
  if (input.feedback !== undefined) {
    body.feedback = input.feedback;
  }
  if (input.snooze !== undefined) {
    body.snooze = input.snooze;
  }
  if (input.draftReply !== undefined) {
    body.draft_reply = input.draftReply;
  }
  const payload = await adminApiRequest<{ plan?: unknown }>({
    endpointPath: '/v1/admin/leads/daily-plan/item-annotations',
    method: 'POST',
    body,
  });
  const plan = parseSalesDailyPlan(payload.plan);
  if (!plan) {
    throw new Error('Item annotation response was empty.');
  }
  return plan;
}

export async function askSalesDailyPlanQuestion(
  question: string,
  planId: string,
): Promise<SalesDailyPlan> {
  const payload = await adminApiRequest<{ plan?: unknown }>({
    endpointPath: '/v1/admin/leads/daily-plan/questions',
    method: 'POST',
    body: { question, plan_id: planId },
  });
  const plan = parseSalesDailyPlan(payload.plan);
  if (!plan) {
    throw new Error('Follow-up question response was empty.');
  }
  return plan;
}

export async function archiveSalesDailyPlanInstruction(
  instructionId: string,
): Promise<SalesDailyPlan | null> {
  const payload = await adminApiRequest<{ plan?: unknown }>({
    endpointPath: `/v1/admin/leads/daily-plan/instructions/${instructionId}`,
    method: 'DELETE',
  });
  return parseSalesDailyPlan(payload.plan);
}

export async function resetSalesDailyPlanMemory(): Promise<void> {
  await adminApiRequest({
    endpointPath: '/v1/admin/leads/daily-plan',
    method: 'DELETE',
    expectedSuccessStatuses: [204],
  });
}
