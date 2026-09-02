import { describe, expect, it } from 'vitest';

import { formatAdminApiTiming } from '@/lib/admin-api-timing';

describe('formatAdminApiTiming', () => {
  it('joins the browser duration with the Lambda Server-Timing header', () => {
    expect(
      formatAdminApiTiming({
        method: 'GET',
        endpointPath: '/v1/admin/contacts',
        status: 200,
        totalMs: 412.6,
        serverTiming: 'app;dur=350.2, cold;dur=3800.0',
      })
    ).toBe('[admin-api] GET /v1/admin/contacts 200 413ms server[app;dur=350.2, cold;dur=3800.0]');
  });

  it('omits the server segment when the header is missing', () => {
    expect(
      formatAdminApiTiming({
        method: 'POST',
        endpointPath: '/v1/admin/tags',
        status: 201,
        totalMs: 99,
        serverTiming: null,
      })
    ).toBe('[admin-api] POST /v1/admin/tags 201 99ms');
  });
});
