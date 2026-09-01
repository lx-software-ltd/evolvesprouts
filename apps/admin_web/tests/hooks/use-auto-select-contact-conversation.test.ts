import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAutoSelectContactConversation } from '@/hooks/use-auto-select-contact-conversation';

describe('useAutoSelectContactConversation', () => {
  it('does not select a conversation without a contact filter', () => {
    const { result } = renderHook(() =>
      useAutoSelectContactConversation('', 'conv-1', false)
    );
    expect(result.current[0]).toBeNull();
  });

  it('selects the first conversation once the filtered list is ready', () => {
    const { result, rerender } = renderHook(
      ({ contactId, firstId, isLoading }) =>
        useAutoSelectContactConversation(contactId, firstId, isLoading),
      { initialProps: { contactId: 'contact-1', firstId: null as string | null, isLoading: true } }
    );
    expect(result.current[0]).toBeNull();

    rerender({ contactId: 'contact-1', firstId: 'conv-1', isLoading: false });
    expect(result.current[0]).toBe('conv-1');
  });

  it('selects a preferred conversation id even without a party filter', () => {
    const { result } = renderHook(() =>
      useAutoSelectContactConversation('', 'conv-1', false, 'conv-9')
    );
    expect(result.current[0]).toBe('conv-9');
  });

  it('does not re-open after the user closes the chat', () => {
    const { result, rerender } = renderHook(
      ({ firstId }) => useAutoSelectContactConversation('contact-1', firstId, false),
      { initialProps: { firstId: 'conv-1' } }
    );
    expect(result.current[0]).toBe('conv-1');

    act(() => {
      result.current[1](null);
    });
    rerender({ firstId: 'conv-1' });
    expect(result.current[0]).toBeNull();
  });
});
