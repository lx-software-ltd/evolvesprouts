export type LeadConversationChannel = 'whatsapp' | 'instagram' | 'messenger';

export const LEAD_CONVERSATION_PREVIEW_LIMIT = 5;

export type LeadConversationThread = {
  id: string;
  channel: LeadConversationChannel;
  lastMessageAt: string | null;
  contactId: string | null;
};

function lastMessageMs(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectLeadConversationThreads(
  threads: LeadConversationThread[],
  extras = false,
  limit = LEAD_CONVERSATION_PREVIEW_LIMIT
): {
  items: LeadConversationThread[];
  overflow: LeadConversationThread | null;
  hasMore: boolean;
} {
  const sorted = [...threads].sort((left, right) => {
    const delta = lastMessageMs(right.lastMessageAt) - lastMessageMs(left.lastMessageAt);
    if (delta !== 0) {
      return delta;
    }
    return right.id.localeCompare(left.id);
  });
  return {
    items: sorted.slice(0, limit),
    overflow: sorted[limit] ?? null,
    hasMore: extras || sorted.length > limit,
  };
}
