import { adminApiRequest } from './api-admin-client';
import { buildAdminListPath } from './admin-list-query';
import { asNullableString, asNumber } from './api-payload';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';
import type {
  ContactSource,
  FunnelStage,
  LeadAiSuggestion,
  LeadAiSuggestionJob,
  LeadAiSuggestionJobStatus,
  LeadAnalytics,
  LeadDetail,
  LeadEvent,
  LeadListFilters,
  LeadNote,
  LeadSummary,
  LeadType,
  LostReason,
} from '@/types/leads';
import { LOST_REASONS } from '@/types/leads';

type ApiSchemas = components['schemas'];
type ApiLeadListResponse = ApiSchemas['LeadListResponse'];
type ApiLeadDetailResponse = ApiSchemas['LeadDetailResponse'];
type ApiCreateLeadRequest = ApiSchemas['CreateLeadRequest'];
type ApiUpdateLeadRequest = ApiSchemas['UpdateLeadRequest'];
type ApiCreateNoteRequest = ApiSchemas['CreateNoteRequest'];
type ApiLeadAnalyticsResponse = ApiSchemas['LeadAnalyticsResponse'];

export interface LeadListParams extends Partial<LeadListFilters> {
  cursor?: string | null;
  limit?: number;
}

export interface AnalyticsParams {
  dateFrom?: string | null;
  dateTo?: string | null;
}

function asRecordNumber(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = asNumber(entry, 0);
  }
  return output;
}

function parseLeadContact(value: unknown): LeadSummary['contact'] {
  const contact = isRecord(value) ? value : {};
  const sourceValue = asNullableString(contact.source);
  return {
    id: asNullableString(contact.id),
    firstName: asNullableString(contact.first_name),
    lastName: asNullableString(contact.last_name),
    email: asNullableString(contact.email),
    phoneRegion: asNullableString(contact.phone_region),
    phoneNationalNumber: asNullableString(contact.phone_national_number),
    phoneE164: asNullableString(contact.phone_e164),
    instagramHandle: asNullableString(contact.instagram_handle),
    source: sourceValue as ContactSource | null,
    sourceDetail: asNullableString(contact.source_detail),
    contactType: asNullableString(contact.contact_type),
    relationshipType: asNullableString(contact.relationship_type),
  };
}

function parseLeadEvent(value: unknown): LeadEvent {
  const event = isRecord(value) ? value : {};
  const eventType = asNullableString(event.event_type) ?? 'created';
  const fromStage = asNullableString(event.from_stage) as FunnelStage | null;
  const toStage = asNullableString(event.to_stage) as FunnelStage | null;
  const metadata = isRecord(event.metadata) ? event.metadata : null;
  return {
    id: asNullableString(event.id) ?? '',
    eventType: eventType as ApiSchemas['LeadEventType'],
    fromStage,
    toStage,
    metadata,
    createdBy: asNullableString(event.created_by),
    createdAt: asNullableString(event.created_at),
  };
}

function parseLeadNote(value: unknown): LeadNote {
  const note = isRecord(value) ? value : {};
  return {
    id: asNullableString(note.id) ?? '',
    content: asNullableString(note.content) ?? '',
    created_by: asNullableString(note.created_by) ?? '',
    created_at: asNullableString(note.created_at) ?? '',
    updated_at: asNullableString(note.updated_at) ?? '',
  };
}

function parseLostReason(value: unknown): LostReason | null {
  const raw = asNullableString(value);
  if (!raw) {
    return null;
  }
  return LOST_REASONS.includes(raw as LostReason) ? (raw as LostReason) : null;
}

function parseLeadSummary(value: unknown): LeadSummary {
  const lead = isRecord(value) ? value : {};
  const stage = asNullableString(lead.funnel_stage) ?? 'new';
  const leadType = asNullableString(lead.lead_type) ?? 'other';
  const tags = Array.isArray(lead.tags)
    ? lead.tags.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    id: asNullableString(lead.id) ?? '',
    contact: parseLeadContact(lead.contact),
    leadType: leadType as LeadType,
    funnelStage: stage as FunnelStage,
    assignedTo: asNullableString(lead.assigned_to),
    createdAt: asNullableString(lead.created_at),
    updatedAt: asNullableString(lead.updated_at),
    convertedAt: asNullableString(lead.converted_at),
    lostAt: asNullableString(lead.lost_at),
    lostReason: parseLostReason(lead.lost_reason),
    daysInStage: asNumber(lead.days_in_stage, 0),
    lastActivityAt: asNullableString(lead.last_activity_at),
    tags,
  };
}

function parseLeadDetail(value: unknown): LeadDetail {
  const base = parseLeadSummary(value);
  const lead = isRecord(value) ? value : {};
  const events = Array.isArray(lead.events) ? lead.events.map((entry) => parseLeadEvent(entry)) : [];
  const notes = Array.isArray(lead.notes) ? lead.notes.map((entry) => parseLeadNote(entry)) : [];
  return {
    ...base,
    family: isRecord(lead.family) ? lead.family : null,
    organization: isRecord(lead.organization) ? lead.organization : null,
    events,
    notes,
  };
}

function buildLeadListPath(params: LeadListParams): string {
  return buildAdminListPath('/v1/admin/leads', {
    filters: {
      stage: params.stage,
      source: params.source,
      lead_type: params.leadType,
      assigned_to: params.assignedTo,
      unassigned: params.unassigned,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      search: params.search,
      sort: params.sort,
      sort_dir: params.sortDir,
    },
    cursor: params.cursor,
    limit: params.limit,
  });
}

export async function listLeads(
  params: LeadListParams,
  signal?: AbortSignal
): Promise<{ items: LeadSummary[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiLeadListResponse>({
    endpointPath: buildLeadListPath(params),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items.map((entry) => parseLeadSummary(entry)) : [],
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, 0),
  };
}

export async function getLead(id: string): Promise<LeadDetail | null> {
  const payload = await adminApiRequest<ApiLeadDetailResponse>({
    endpointPath: `/v1/admin/leads/${id}`,
    method: 'GET',
  });
  return payload.lead ? parseLeadDetail(payload.lead) : null;
}

export async function createLead(body: ApiCreateLeadRequest): Promise<LeadDetail | null> {
  const payload = await adminApiRequest<ApiLeadDetailResponse>({
    endpointPath: '/v1/admin/leads',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.lead ? parseLeadDetail(payload.lead) : null;
}

export async function updateLead(id: string, body: ApiUpdateLeadRequest): Promise<LeadDetail | null> {
  const payload = await adminApiRequest<ApiLeadDetailResponse>({
    endpointPath: `/v1/admin/leads/${id}`,
    method: 'PATCH',
    body,
  });
  return payload.lead ? parseLeadDetail(payload.lead) : null;
}

export async function createLeadNote(
  leadId: string,
  body: ApiCreateNoteRequest
): Promise<LeadNote | null> {
  const payload = await adminApiRequest<{ note?: ApiSchemas['Note'] }>({
    endpointPath: `/v1/admin/leads/${leadId}/notes`,
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  return payload.note ? parseLeadNote(payload.note) : null;
}

function parseLeadAiSuggestion(value: unknown): LeadAiSuggestion | null {
  if (!isRecord(value)) {
    return null;
  }
  const followUpsRaw = Array.isArray(value.follow_ups) ? value.follow_ups : [];
  const followUps = followUpsRaw
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      channel: asNullableString(entry.channel) ?? 'unknown',
      messageExcerpt: asNullableString(entry.message_excerpt) ?? '',
      draftReply: asNullableString(entry.draft_reply) ?? '',
      rationale: asNullableString(entry.rationale) ?? '',
    }));
  const staleReasons = Array.isArray(value.stale_reasons)
    ? value.stale_reasons.map((entry) => String(entry))
    : [];
  return {
    id: asNullableString(value.id) ?? '',
    leadId: asNullableString(value.lead_id) ?? '',
    summary: asNullableString(value.summary) ?? '',
    actions: Array.isArray(value.actions)
      ? value.actions.map((entry) => String(entry)).filter(Boolean)
      : [],
    followUps,
    risks: Array.isArray(value.risks)
      ? value.risks.map((entry) => String(entry)).filter(Boolean)
      : [],
    generatedAt: asNullableString(value.generated_at),
    generatedBy: asNullableString(value.generated_by),
    model: asNullableString(value.model),
    conversationWatermarkAt: asNullableString(value.conversation_watermark_at),
    isStale: Boolean(value.is_stale),
    staleReasons,
    staleAfter: asNullableString(value.stale_after),
    latestMessageAt: asNullableString(value.latest_message_at),
  };
}


function parseLeadAiSuggestionJob(value: unknown): LeadAiSuggestionJob | null {
  if (!isRecord(value)) {
    return null;
  }
  const statusRaw = asNullableString(value.status);
  const status = (statusRaw ?? 'pending') as LeadAiSuggestionJobStatus;
  return {
    id: asNullableString(value.id) ?? '',
    leadId: asNullableString(value.lead_id) ?? '',
    status,
    errorMessage: asNullableString(value.error_message),
    suggestionId: asNullableString(value.suggestion_id),
    createdAt: asNullableString(value.created_at),
    startedAt: asNullableString(value.started_at),
    finishedAt: asNullableString(value.finished_at),
    updatedAt: asNullableString(value.updated_at),
    queueWaitMs:
      typeof value.queue_wait_ms === 'number' ? value.queue_wait_ms : null,
    durationMs: typeof value.duration_ms === 'number' ? value.duration_ms : null,
    suggestion: parseLeadAiSuggestion(value.suggestion),
  };
}

export async function fetchLeadAiSuggestion(leadId: string): Promise<LeadAiSuggestion | null> {
  const payload = await adminApiRequest<{ suggestion?: unknown }>({
    endpointPath: `/v1/admin/leads/${leadId}/ai-suggestion`,
    method: 'GET',
  });
  return parseLeadAiSuggestion(payload.suggestion);
}

export async function enqueueLeadAiSuggestionJob(
  leadId: string,
): Promise<LeadAiSuggestionJob> {
  const payload = await adminApiRequest<{ job?: unknown }>({
    endpointPath: `/v1/admin/leads/${leadId}/ai-suggestion`,
    method: 'POST',
    expectedSuccessStatuses: [202],
  });
  const job = parseLeadAiSuggestionJob(payload.job);
  if (!job) {
    throw new Error('AI suggestion job response was empty.');
  }
  return job;
}

export async function fetchLeadAiSuggestionJob(
  leadId: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<LeadAiSuggestionJob> {
  const payload = await adminApiRequest<{ job?: unknown }>({
    endpointPath: `/v1/admin/leads/${leadId}/ai-suggestion/jobs/${jobId}`,
    method: 'GET',
    expectedSuccessStatuses: [200],
    signal,
  });
  const job = parseLeadAiSuggestionJob(payload.job);
  if (!job) {
    throw new Error('AI suggestion job response was empty.');
  }
  return job;
}

export async function pollLeadAiSuggestionJob(
  leadId: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<LeadAiSuggestionJob> {
  const maxMs = 5 * 60 * 1000;
  const started = Date.now();
  let delayMs = 1000;
  while (Date.now() - started < maxMs) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const job = await fetchLeadAiSuggestionJob(leadId, jobId, signal);
    if (job.status === 'succeeded') {
      return job;
    }
    if (job.status === 'failed') {
      throw new Error(job.errorMessage?.trim() || 'AI suggestion generation failed.');
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
    delayMs = Math.min(Math.floor(delayMs * 1.25), 5000);
  }
  throw new Error(
    'AI suggestion is taking longer than expected; refresh the lead to check again.',
  );
}

/** @deprecated Prefer enqueue + poll; kept for callers that want the final suggestion. */
export async function generateLeadAiSuggestion(leadId: string): Promise<LeadAiSuggestion> {
  const queued = await enqueueLeadAiSuggestionJob(leadId);
  const finished = await pollLeadAiSuggestionJob(leadId, queued.id);
  if (!finished.suggestion) {
    throw new Error('AI suggestion job completed without a suggestion.');
  }
  return finished.suggestion;
}

export async function getLeadAnalytics(params: AnalyticsParams): Promise<LeadAnalytics> {
  const payload = await adminApiRequest<ApiLeadAnalyticsResponse>({
    endpointPath: buildAdminListPath('/v1/admin/leads/analytics', {
      filters: { date_from: params.dateFrom, date_to: params.dateTo },
    }),
    method: 'GET',
  });
  const assigneeStats = Array.isArray(payload.assignee_stats)
    ? payload.assignee_stats.map((entry) => ({
        assignedTo: asNullableString(isRecord(entry) ? entry.assigned_to : null),
        total: asNumber(isRecord(entry) ? entry.total : null, 0),
        converted: asNumber(isRecord(entry) ? entry.converted : null, 0),
        conversionRate: asNumber(isRecord(entry) ? entry.conversion_rate : null, 0),
      }))
    : [];
  const leadsOverTime = Array.isArray(payload.leads_over_time)
    ? payload.leads_over_time
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          period: asNullableString(entry.period) ?? '',
          count: asNumber(entry.count, 0),
        }))
    : [];
  return {
    funnel: asRecordNumber(payload.funnel),
    conversionRate: asNumber(payload.conversion_rate, 0),
    avgDaysToConvert:
      typeof payload.avg_days_to_convert === 'number' ? payload.avg_days_to_convert : null,
    leadsThisWeek: asNumber(payload.leads_this_week, 0),
    leadsThisMonth: asNumber(payload.leads_this_month, 0),
    sourceBreakdown: asRecordNumber(payload.source_breakdown),
    stageConversionRates: asRecordNumber(payload.stage_conversion_rates),
    avgDaysInStage: asRecordNumber(payload.avg_days_in_stage),
    leadsOverTime,
    assigneeStats,
  };
}
