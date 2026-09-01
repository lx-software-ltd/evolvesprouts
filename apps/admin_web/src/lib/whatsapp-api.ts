import { adminApiRequest } from './api-admin-client';
import { asNumber, asNullableString, unwrapPayload } from './api-payload';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type ApiConversationList = ApiSchemas['WhatsAppConversationListResponse'];
type ApiMessageList = ApiSchemas['WhatsAppMessageListResponse'];

export type WhatsAppConversationSummary = {
  id: string;
  waId: string;
  profileName: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  firstInboundAt: string | null;
  lastMessageAt: string | null;
  inboundCount: number;
  outboundCount: number;
  createdAt: string | null;
};

export type WhatsAppMessageSummary = {
  id: string;
  waMessageId: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  body: string | null;
  sentAt: string;
};

export interface WhatsAppConversationListParams {
  cursor?: string | null;
  limit?: number;
  q?: string;
  contactId?: string;
}

function parseConversation(value: unknown): WhatsAppConversationSummary {
  const row = isRecord(value) ? value : {};
  return {
    id: asNullableString(row.id) ?? '',
    waId: asNullableString(row.wa_id) ?? '',
    profileName: asNullableString(row.profile_name),
    contactId: asNullableString(row.contact_id),
    contactName: asNullableString(row.contact_name),
    leadId: asNullableString(row.lead_id),
    firstInboundAt: asNullableString(row.first_inbound_at),
    lastMessageAt: asNullableString(row.last_message_at),
    inboundCount: asNumber(row.inbound_count, 0),
    outboundCount: asNumber(row.outbound_count, 0),
    createdAt: asNullableString(row.created_at),
  };
}

function parseMessage(value: unknown): WhatsAppMessageSummary {
  const row = isRecord(value) ? value : {};
  const direction = asNullableString(row.direction) === 'outbound' ? 'outbound' : 'inbound';
  return {
    id: asNullableString(row.id) ?? '',
    waMessageId: asNullableString(row.wa_message_id) ?? '',
    direction,
    messageType: asNullableString(row.message_type) ?? 'text',
    body: asNullableString(row.body),
    sentAt: asNullableString(row.sent_at) ?? '',
  };
}

export async function listWhatsAppConversations(
  params: WhatsAppConversationListParams,
  signal?: AbortSignal
): Promise<{
  items: WhatsAppConversationSummary[];
  nextCursor: string | null;
  totalCount: number;
}> {
  const query = new URLSearchParams();
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }
  if (typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
    query.set('limit', String(params.limit));
  }
  if (params.q?.trim()) {
    query.set('q', params.q.trim());
  }
  if (params.contactId?.trim()) {
    query.set('contact_id', params.contactId.trim());
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = unwrapPayload(
    await adminApiRequest<ApiConversationList>({
      endpointPath: `/v1/admin/whatsapp/conversations${suffix}`,
      signal,
    })
  );
  const items = Array.isArray(payload.items) ? payload.items.map(parseConversation) : [];
  return {
    items,
    nextCursor: asNullableString(payload.next_cursor),
    totalCount: asNumber(payload.total_count, items.length),
  };
}

export async function listWhatsAppMessages(
  conversationId: string,
  signal?: AbortSignal
): Promise<{
  conversation: WhatsAppConversationSummary;
  items: WhatsAppMessageSummary[];
}> {
  const payload = unwrapPayload(
    await adminApiRequest<ApiMessageList>({
      endpointPath: `/v1/admin/whatsapp/conversations/${conversationId}/messages`,
      signal,
    })
  );
  return {
    conversation: parseConversation(payload.conversation),
    items: Array.isArray(payload.items) ? payload.items.map(parseMessage) : [],
  };
}
