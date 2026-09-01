import { describe, expect, it } from 'vitest';

import {
  selectLatestLeadConversationThread,
  selectLeadConversationMessages,
  sortMessagesNewestFirst,
} from '@/lib/lead-conversation-previews';

describe('selectLatestLeadConversationThread', () => {
  it('returns the most recently active thread', () => {
    const selected = selectLatestLeadConversationThread([
      {
        id: '1',
        channel: 'whatsapp',
        lastMessageAt: '2026-03-01T10:00:00Z',
        contactId: 'c1',
        inboundCount: 1,
        outboundCount: 0,
      },
      {
        id: '2',
        channel: 'instagram',
        lastMessageAt: '2026-03-06T10:00:00Z',
        contactId: 'c1',
        inboundCount: 4,
        outboundCount: 1,
      },
      {
        id: '3',
        channel: 'messenger',
        lastMessageAt: '2026-03-02T10:00:00Z',
        contactId: 'c1',
        inboundCount: 2,
        outboundCount: 2,
      },
    ]);

    expect(selected?.id).toBe('2');
    expect(selected?.channel).toBe('instagram');
  });

  it('returns null when there are no threads', () => {
    expect(selectLatestLeadConversationThread([])).toBeNull();
  });
});

describe('selectLeadConversationMessages', () => {
  it('keeps the three latest messages and marks overflow', () => {
    const selected = selectLeadConversationMessages([
      { id: '1', direction: 'inbound', body: 'oldest', sentAt: '2026-03-01T10:00:00Z' },
      { id: '2', direction: 'outbound', body: 'newest', sentAt: '2026-03-04T10:00:00Z' },
      { id: '3', direction: 'inbound', body: 'middle', sentAt: '2026-03-03T10:00:00Z' },
      { id: '4', direction: 'inbound', body: 'second', sentAt: '2026-03-02T10:00:00Z' },
    ]);

    expect(selected.items.map((row) => row.body)).toEqual(['newest', 'middle', 'second']);
    expect(selected.hasMore).toBe(true);
  });

  it('marks hasMore when the conversation has more than three messages', () => {
    const selected = selectLeadConversationMessages(
      [{ id: '1', direction: 'inbound', body: 'only', sentAt: '2026-03-01T10:00:00Z' }],
      true
    );
    expect(selected.items).toHaveLength(1);
    expect(selected.hasMore).toBe(true);
  });
});

describe('sortMessagesNewestFirst', () => {
  it('orders by sentAt descending', () => {
    const sorted = sortMessagesNewestFirst([
      { id: 'old', sentAt: '2026-03-01T10:00:00Z' },
      { id: 'new', sentAt: '2026-03-02T10:00:00Z' },
    ]);
    expect(sorted.map((row) => row.id)).toEqual(['new', 'old']);
  });
});
