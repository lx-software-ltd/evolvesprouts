import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAutoExpandPartyConversation } from '@/hooks/use-auto-expand-party-conversation';

function renderAutoExpand(initial: {
  partyFilterKey: string;
  firstConversationId: string | null;
  isLoading: boolean;
  expandedId?: string | null;
}) {
  const expand = vi.fn();
  const hook = renderHook(
    (props: typeof initial) =>
      useAutoExpandPartyConversation({
        partyFilterKey: props.partyFilterKey,
        firstConversationId: props.firstConversationId,
        isLoading: props.isLoading,
        expanded: { expandedId: props.expandedId ?? null, expand },
      }),
    { initialProps: initial }
  );
  return { ...hook, expand };
}

describe('useAutoExpandPartyConversation', () => {
  it('does nothing without a party filter', () => {
    const { expand } = renderAutoExpand({ partyFilterKey: '', firstConversationId: 'conv-1', isLoading: false });
    expect(expand).not.toHaveBeenCalled();
  });

  it('expands the first conversation once the filtered list is ready', () => {
    const { expand, rerender } = renderAutoExpand({
      partyFilterKey: 'contact-1',
      firstConversationId: null,
      isLoading: true,
    });
    expect(expand).not.toHaveBeenCalled();

    rerender({ partyFilterKey: 'contact-1', firstConversationId: 'conv-1', isLoading: false });
    expect(expand).toHaveBeenCalledWith('conv-1');
    expect(expand).toHaveBeenCalledTimes(1);
  });

  it('leaves a conversation deep link alone', () => {
    const { expand } = renderAutoExpand({
      partyFilterKey: 'contact-1',
      firstConversationId: 'conv-1',
      isLoading: false,
      expandedId: 'conv-9',
    });
    expect(expand).not.toHaveBeenCalled();
  });

  it('does not re-open after the operator collapses the thread', () => {
    const { expand, rerender } = renderAutoExpand({
      partyFilterKey: 'contact-1',
      firstConversationId: 'conv-1',
      isLoading: false,
      expandedId: null,
    });
    expect(expand).toHaveBeenCalledTimes(1);

    rerender({ partyFilterKey: 'contact-1', firstConversationId: 'conv-1', isLoading: false, expandedId: 'conv-1' });
    rerender({ partyFilterKey: 'contact-1', firstConversationId: 'conv-1', isLoading: false, expandedId: null });
    expect(expand).toHaveBeenCalledTimes(1);
  });

  it('opens again for a different party filter', () => {
    const { expand, rerender } = renderAutoExpand({
      partyFilterKey: 'contact-1',
      firstConversationId: 'conv-1',
      isLoading: false,
    });
    expect(expand).toHaveBeenCalledWith('conv-1');

    rerender({ partyFilterKey: 'family-2', firstConversationId: 'conv-5', isLoading: false });
    expect(expand).toHaveBeenLastCalledWith('conv-5');
    expect(expand).toHaveBeenCalledTimes(2);
  });
});
