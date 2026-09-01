import { adminApiRequest } from './api-admin-client';
import { asNullableString, asNumber, unwrapPayload } from './api-payload';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';
import type {
  ContactSource,
  FunnelStage,
  LeadAnalytics,
  LeadDetail,
  LeadEvent,
  LeadListFilters,
  LeadNote,
  LeadSummary,
  LeadType,
} from '@/types/leads';

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
    lostReason: asNullableString(lead.lost_reason),
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

function buildLeadListQuery(params: LeadListParams): string {
  const query = new URLSearchParams();
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }
  if (typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
    query.set('limit', `${Math.floor(params.limit)}`);
  }
  if (params.stage && params.stage.length > 0) {
    query.set('stage', params.stage.join(','));
  }
  if (params.source && params.source.length > 0) {
    query.set('source', params.source.join(','));
  }
  if (params.leadType && params.leadType.length > 0) {
    query.set('lead_type', params.leadType.join(','));
  }
  if (params.assignedTo) {
    query.set('assigned_to', params.assignedTo);
  }
  if (params.unassigned) {
    query.set('unassigned', 'true');
  }
  if (params.dateFrom) {
    query.set('date_from', params.dateFrom);
  }
  if (params.dateTo) {
    query.set('date_to', params.dateTo);
  }
  if (params.search?.trim()) {
    query.set('search', params.search.trim());
  }
  if (params.sort) {
    query.set('sort', params.sort);
  }
  if (params.sortDir) {
    query.set('sort_dir', params.sortDir);
  }
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

export async function listLeads(
  params: LeadListParams,
  signal?: AbortSignal
): Promise<{ items: LeadSummary[]; nextCursor: string | null; totalCount: number }> {
  const payload = await adminApiRequest<ApiLeadListResponse>({
    endpointPath: `/v1/admin/leads${buildLeadListQuery(params)}`,
    method: 'GET',
    signal,
  });
  const root = unwrapPayload(payload);
  return {
    items: Array.isArray(root.items) ? root.items.map((entry) => parseLeadSummary(entry)) : [],
    nextCursor: asNullableString(root.next_cursor),
    totalCount: asNumber(root.total_count, 0),
  };
}

export async function getLead(id: string): Promise<LeadDetail | null> {
  const payload = await adminApiRequest<ApiLeadDetailResponse>({
    endpointPath: `/v1/admin/leads/${id}`,
    method: 'GET',
  });
  const root = unwrapPayload(payload);
  return root.lead ? parseLeadDetail(root.lead) : null;
}

export async function createLead(body: ApiCreateLeadRequest): Promise<LeadDetail | null> {
  const payload = await adminApiRequest<ApiLeadDetailResponse>({
    endpointPath: '/v1/admin/leads',
    method: 'POST',
    body,
    expectedSuccessStatuses: [200, 201],
  });
  const root = unwrapPayload(payload);
  return root.lead ? parseLeadDetail(root.lead) : null;
}

export async function updateLead(id: string, body: ApiUpdateLeadRequest): Promise<LeadDetail | null> {
  const payload = await adminApiRequest<ApiLeadDetailResponse>({
    endpointPath: `/v1/admin/leads/${id}`,
    method: 'PATCH',
    body,
  });
  const root = unwrapPayload(payload);
  return root.lead ? parseLeadDetail(root.lead) : null;
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
  const root = unwrapPayload(payload);
  return root.note ? parseLeadNote(root.note) : null;
}

export async function getLeadAnalytics(params: AnalyticsParams): Promise<LeadAnalytics> {
  const query = new URLSearchParams();
  if (params.dateFrom) {
    query.set('date_from', params.dateFrom);
  }
  if (params.dateTo) {
    query.set('date_to', params.dateTo);
  }
  const queryString = query.toString();
  const endpointPath = queryString ? `/v1/admin/leads/analytics?${queryString}` : '/v1/admin/leads/analytics';
  const payload = await adminApiRequest<ApiLeadAnalyticsResponse>({
    endpointPath,
    method: 'GET',
  });
  const root = unwrapPayload(payload);
  const assigneeStats = Array.isArray(root.assignee_stats)
    ? root.assignee_stats.map((entry) => ({
        assignedTo: asNullableString(isRecord(entry) ? entry.assigned_to : null),
        total: asNumber(isRecord(entry) ? entry.total : null, 0),
        converted: asNumber(isRecord(entry) ? entry.converted : null, 0),
        conversionRate: asNumber(isRecord(entry) ? entry.conversion_rate : null, 0),
      }))
    : [];
  const leadsOverTime = Array.isArray(root.leads_over_time)
    ? root.leads_over_time
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          period: asNullableString(entry.period) ?? '',
          count: asNumber(entry.count, 0),
        }))
    : [];
  return {
    funnel: asRecordNumber(root.funnel),
    conversionRate: asNumber(root.conversion_rate, 0),
    avgDaysToConvert:
      typeof root.avg_days_to_convert === 'number' ? root.avg_days_to_convert : null,
    leadsThisWeek: asNumber(root.leads_this_week, 0),
    leadsThisMonth: asNumber(root.leads_this_month, 0),
    sourceBreakdown: asRecordNumber(root.source_breakdown),
    stageConversionRates: asRecordNumber(root.stage_conversion_rates),
    avgDaysInStage: asRecordNumber(root.avg_days_in_stage),
    leadsOverTime,
    assigneeStats,
  };
}
