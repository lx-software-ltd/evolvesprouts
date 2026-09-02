import { describe, expect, it } from 'vitest';

import { unwrapPayload } from '@/lib/api-payload';

describe('unwrapPayload', () => {
  it('returns the root payload without unwrapping a data field', () => {
    const payload = { items: [1], data: { nested: true } };
    expect(unwrapPayload(payload)).toBe(payload);
    expect(unwrapPayload(payload).data).toEqual({ nested: true });
  });
});
