import { describe, expect, it } from 'vitest';

import {
  formatInboxImportCounters,
  parseInboxImportJob,
} from '@/lib/inbox-import-api';

describe('inbox-import-api', () => {
  it('parses a job payload and formats counters', () => {
    const job = parseInboxImportJob({
      id: 'job-1',
      kind: 'meta_graph',
      channel: 'instagram',
      attachment_asset_id: null,
      status: 'succeeded_with_errors',
      error_message: null,
      counters: { stored: 4, duplicates: 1, skipped: 2 },
      created_at: '2026-08-01T00:00:00+00:00',
      updated_at: '2026-08-01T00:00:00+00:00',
    });
    expect(job.status).toBe('succeeded_with_errors');
    expect(job.channel).toBe('instagram');
    expect(formatInboxImportCounters(job.counters)).toBe(
      'Stored 4, duplicates 1, skipped 2.'
    );
  });
});
