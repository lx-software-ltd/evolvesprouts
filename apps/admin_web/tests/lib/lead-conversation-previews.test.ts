import { describe, expect, it } from 'vitest';

import { selectLeadConversationThreads } from '@/lib/lead-conversation-previews';

describe('selectLeadConversationThreads', () => {
  it('keeps the five latest conversations and exposes overflow', () => {
    const selected = selectLeadConversationThreads(
      [
        { id: '1', channel: 'whatsapp', lastMessageAt: '2026-03-01T10:00:00Z', contactId: 'c1' },
        { id: '2', channel: 'instagram', lastMessageAt: '2026-03-06T10:00:00Z', contactId: 'c1' },
        { id: '3', channel: 'messenger', lastMessageAt: '2026-03-02T10:00:00Z', contactId: 'c1' },
        { id: '4', channel: 'whatsapp', lastMessageAt: '2026-03-05T10:00:00Z', contactId: 'c1' },
        { id: '5', channel: 'instagram', lastMessageAt: '2026-03-03T10:00:00Z', contactId: 'c1' },
        { id: '6', channel: 'messenger', lastMessageAt: '2026-03-04T10:00:00Z', contactId: 'c1' },
      ]
    );

    expect(selected.items.map((row) => row.id)).toEqual(['2', '4', '6', '5', '3']);
    expect(selected.overflow?.id).toBe('1');
    expect(selected.hasMore).toBe(true);
  });

  it('marks hasMore when a channel still has another page', () => {
    const selected = selectLeadConversationThreads(
      [{ id: '1', channel: 'whatsapp', lastMessageAt: '2026-03-01T10:00:00Z', contactId: 'c1' }],
      true
    );
    expect(selected.items).toHaveLength(1);
    expect(selected.overflow).toBeNull();
    expect(selected.hasMore).toBe(true);
  });
});
