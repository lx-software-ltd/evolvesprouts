import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DRAFT_RECORD_ID, useExpandedRecord } from '@/hooks/use-expanded-record';

describe('useExpandedRecord', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/contacts');
  });

  it('keeps one row open at a time and mirrors it to the URL', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useExpandedRecord({ onChange }));
    expect(result.current.expandedId).toBeNull();

    act(() => {
      result.current.toggle('c1');
    });
    expect(result.current.expandedId).toBe('c1');
    expect(result.current.isExpanded('c1')).toBe(true);
    expect(window.location.search).toBe('?record=c1');
    expect(onChange).toHaveBeenLastCalledWith('c1');

    act(() => {
      result.current.toggle('c2');
    });
    expect(result.current.expandedId).toBe('c2');
    expect(result.current.isExpanded('c1')).toBe(false);

    act(() => {
      result.current.toggle('c2');
    });
    expect(result.current.expandedId).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('restores the open row from the URL and opens the draft row under a sentinel id', () => {
    window.history.replaceState(null, '', '/contacts?record=c9&tab=x');
    const { result } = renderHook(() => useExpandedRecord());
    expect(result.current.expandedId).toBe('c9');

    act(() => {
      result.current.openDraft();
    });
    expect(result.current.isDraftOpen).toBe(true);
    expect(result.current.expandedId).toBe(DRAFT_RECORD_ID);
    expect(window.location.search).toBe('?record=new&tab=x');

    act(() => {
      result.current.collapse();
    });
    expect(window.location.search).toBe('?tab=x');
  });

  it('asks before replacing a dirty editor and applies the switch on confirm', () => {
    let dirty = false;
    const { result } = renderHook(() => useExpandedRecord({ isDirty: () => dirty }));

    act(() => {
      result.current.expand('c1');
    });
    dirty = true;
    act(() => {
      result.current.toggle('c2');
    });
    expect(result.current.expandedId).toBe('c1');
    expect(result.current.discardPrompt.open).toBe(true);

    act(() => {
      result.current.discardPrompt.cancel();
    });
    expect(result.current.expandedId).toBe('c1');
    expect(result.current.discardPrompt.open).toBe(false);

    act(() => {
      result.current.toggle('c2');
    });
    act(() => {
      result.current.discardPrompt.confirm();
    });
    expect(result.current.expandedId).toBe('c2');
    expect(result.current.discardPrompt.open).toBe(false);
  });
});
