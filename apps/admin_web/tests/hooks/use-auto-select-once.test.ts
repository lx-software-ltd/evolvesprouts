import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAutoSelectOnce } from '@/hooks/use-auto-select-once';

describe('useAutoSelectOnce', () => {
  it('does not select until the key is ready', () => {
    const select = vi.fn();
    const { rerender } = renderHook(
      ({ key, isReady }) => useAutoSelectOnce(key, isReady, select),
      { initialProps: { key: 'party-1', isReady: false } }
    );
    expect(select).not.toHaveBeenCalled();

    rerender({ key: 'party-1', isReady: true });
    expect(select).toHaveBeenCalledTimes(1);

    rerender({ key: 'party-1', isReady: true });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('selects again when the key changes', () => {
    const select = vi.fn();
    const { rerender } = renderHook(
      ({ key }) => useAutoSelectOnce(key, true, select),
      { initialProps: { key: 'party-1' } }
    );
    expect(select).toHaveBeenCalledTimes(1);

    rerender({ key: 'party-2' });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('allows another select after the key is cleared', () => {
    const select = vi.fn();
    const { rerender } = renderHook(
      ({ key }) => useAutoSelectOnce(key, true, select),
      { initialProps: { key: 'party-1' } }
    );
    expect(select).toHaveBeenCalledTimes(1);

    rerender({ key: '' });
    rerender({ key: 'party-1' });
    expect(select).toHaveBeenCalledTimes(2);
  });
});
