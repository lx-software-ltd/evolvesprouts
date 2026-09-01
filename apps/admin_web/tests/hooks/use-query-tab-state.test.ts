import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useLocationSearchParam, useQueryTabState } from '@/hooks/use-query-tab-state';

const VALID_KEYS = ['alpha', 'beta', 'gamma'] as const;
type Key = (typeof VALID_KEYS)[number];
const DEFAULT_KEY: Key = 'alpha';

function setLocation(pathAndQuery: string) {
  window.history.replaceState(null, '', pathAndQuery);
}

describe('useQueryTabState', () => {
  const originalUrl = 'http://localhost/finance';

  beforeEach(() => {
    setLocation('/finance');
  });

  afterEach(() => {
    setLocation('/finance');
  });

  it('starts at the default when the URL has no param', () => {
    setLocation('/finance');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    expect(result.current[0]).toBe('alpha');
    expect(window.location.pathname + window.location.search).toBe('/finance');
  });

  it('seeds state from a valid tab param on mount', () => {
    setLocation('/finance?tab=beta');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    expect(result.current[0]).toBe('beta');
    expect(window.location.search).toBe('?tab=beta');
  });

  it('falls back to the default and strips the param when the URL has an unknown tab value', () => {
    setLocation('/finance?tab=nope');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    expect(result.current[0]).toBe('alpha');
    expect(window.location.search).toBe('');
  });

  it('strips the param when the URL explicitly names the default tab', () => {
    setLocation('/finance?tab=alpha');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    expect(result.current[0]).toBe('alpha');
    expect(window.location.search).toBe('');
  });

  it('updates the URL when switching to a non-default tab', () => {
    setLocation('/finance');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    act(() => {
      result.current[1]('gamma');
    });
    expect(result.current[0]).toBe('gamma');
    expect(window.location.search).toBe('?tab=gamma');
  });

  it('removes the param when switching back to the default tab', () => {
    setLocation('/finance?tab=gamma');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    act(() => {
      result.current[1]('alpha');
    });
    expect(result.current[0]).toBe('alpha');
    expect(window.location.search).toBe('');
  });

  it('preserves unrelated query parameters when updating the tab', () => {
    setLocation('/finance?code=xyz&tab=beta');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    expect(result.current[0]).toBe('beta');
    act(() => {
      result.current[1]('gamma');
    });
    expect(window.location.search).toContain('code=xyz');
    expect(window.location.search).toContain('tab=gamma');
    act(() => {
      result.current[1]('alpha');
    });
    expect(window.location.search).toBe('?code=xyz');
  });

  it('uses replaceState so tab changes do not create history entries', () => {
    setLocation('/finance');
    const before = window.history.length;
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    act(() => {
      result.current[1]('beta');
    });
    act(() => {
      result.current[1]('gamma');
    });
    act(() => {
      result.current[1]('alpha');
    });
    expect(window.history.length).toBe(before);
    expect(window.location.search).toBe('');
  });

  it('supports a custom param name', () => {
    setLocation('/finance?view=beta');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY, 'view')
    );
    expect(result.current[0]).toBe('beta');
    act(() => {
      result.current[1]('gamma');
    });
    expect(window.location.search).toBe('?view=gamma');
  });

  it('reads a named search param via useLocationSearchParam', () => {
    setLocation('/sales?tab=instagram&contact=abc-123');
    const { result } = renderHook(() => useLocationSearchParam('contact'));
    expect(result.current).toBe('abc-123');
  });

  it('ignores the starting URL when a different pathname is used', () => {
    setLocation('/services?tab=gamma');
    const { result } = renderHook(() =>
      useQueryTabState<Key>(VALID_KEYS, DEFAULT_KEY)
    );
    expect(result.current[0]).toBe('gamma');
    expect(window.location.pathname).toBe('/services');
    void originalUrl;
  });
});
