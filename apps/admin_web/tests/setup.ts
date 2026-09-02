import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { resetAdminQueryClientForTests } from '@/lib/admin-query-client';

const fetchMock = vi.fn();
const clipboardWriteTextMock = vi.fn(async () => undefined);
const confirmMock = vi.fn(() => true);

vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('confirm', confirmMock);

Object.defineProperty(window.navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: clipboardWriteTextMock,
  },
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // Fresh cache per test; staleTime 0 keeps the fetch-on-mount behaviour
  // feature tests assert on (production caches for 30s).
  resetAdminQueryClientForTests({ queries: { staleTime: 0 } });
  fetchMock.mockReset();
  clipboardWriteTextMock.mockReset();
  confirmMock.mockReset();
  confirmMock.mockReturnValue(true);
});
