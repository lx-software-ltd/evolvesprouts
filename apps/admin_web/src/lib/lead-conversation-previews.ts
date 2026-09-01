export type LeadConversationChannel = 'whatsapp' | 'instagram' | 'messenger';

export const LEAD_CONVERSATION_MESSAGE_LIMIT = 3;

export type LeadConversationThread = {
  id: string;
  channel: LeadConversationChannel;
  lastMessageAt: string | null;
  contactId: string | null;
  inboundCount: number;
  outboundCount: number;
};

export type LeadConversationMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  sentAt: string;
};

function lastMessageMs(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortMessagesNewestFirst<T extends { id: string; sentAt: string }>(messages: T[]): T[] {
  return [...messages].sort((left, right) => {
    const delta = lastMessageMs(right.sentAt) - lastMessageMs(left.sentAt);
    if (delta !== 0) {
      return delta;
    }
    return right.id.localeCompare(left.id);
  });
}

export function selectLatestLeadConversationThread(
  threads: LeadConversationThread[]
): LeadConversationThread | null {
  const sorted = [...threads].sort((left, right) => {
    const delta = lastMessageMs(right.lastMessageAt) - lastMessageMs(left.lastMessageAt);
    if (delta !== 0) {
      return delta;
    }
    return right.id.localeCompare(left.id);
  });
  return sorted[0] ?? null;
}

export function selectLeadConversationMessages<T extends LeadConversationMessage>(
  messages: T[],
  extras = false,
  limit = LEAD_CONVERSATION_MESSAGE_LIMIT
): {
  items: T[];
  hasMore: boolean;
} {
  const sorted = sortMessagesNewestFirst(messages);
  return {
    items: sorted.slice(0, limit),
    hasMore: extras || sorted.length > limit,
  };
}
