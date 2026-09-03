import { vi } from 'vitest';

import type { UseExpandedRecordReturn } from '@/hooks/use-expanded-record';

/** Inert `useExpandedRecord` return for table components that receive it as a prop. */
export function makeExpanded(overrides: Partial<UseExpandedRecordReturn> = {}): UseExpandedRecordReturn {
  return {
    expandedId: null,
    isDraftOpen: false,
    isExpanded: vi.fn(() => false),
    toggle: vi.fn(),
    expand: vi.fn(),
    openDraft: vi.fn(),
    collapse: vi.fn(),
    discardPrompt: { open: false, confirm: vi.fn(), cancel: vi.fn() },
    ...overrides,
  };
}
