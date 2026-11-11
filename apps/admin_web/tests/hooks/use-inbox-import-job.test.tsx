import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  INBOX_IMPORT_POLL_MS,
  INBOX_IMPORT_SUCCESS_BANNER_MS,
  useInboxImportJob,
} from '@/hooks/use-inbox-import-job';
import { listInboxImportJobs, type InboxImportJobSummary } from '@/lib/inbox-import-api';

vi.mock('@/lib/inbox-import-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/inbox-import-api')>('@/lib/inbox-import-api');
  return {
    ...actual,
    listInboxImportJobs: vi.fn(),
  };
});

const listJobs = vi.mocked(listInboxImportJobs);

function job(overrides: Partial<InboxImportJobSummary> = {}): InboxImportJobSummary {
  return {
    id: 'job-1',
    kind: 'meta_graph',
    channel: 'instagram',
    attachmentAssetId: null,
    status: 'pending',
    errorMessage: null,
    counters: null,
    createdAt: '2026-08-02T00:00:00+00:00',
    updatedAt: '2026-08-02T00:00:00+00:00',
    ...overrides,
  };
}

describe('useInboxImportJob', () => {
  afterEach(() => {
    vi.useRealTimers();
    listJobs.mockReset();
  });

  it('does not restore a succeeded job from the job list', async () => {
    listJobs.mockResolvedValue([job({ status: 'succeeded' })]);
    const { result } = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    await waitFor(() => {
      expect(listJobs).toHaveBeenCalled();
    });
    expect(result.current.importJob).toBeNull();
  });

  it('restores an in-flight job and dismisses it after success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listJobs.mockResolvedValue([job({ status: 'processing' })]);
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useInboxImportJob({
        endpointPath: '/v1/admin/meta/import-jobs',
        channel: 'instagram',
        onSettled,
      })
    );
    await waitFor(() => {
      expect(result.current.importJob?.status).toBe('processing');
    });

    listJobs.mockResolvedValue([
      job({ status: 'succeeded', counters: { stored: 2, duplicates: 0, skipped: 0 } }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_IMPORT_POLL_MS);
    });
    expect(result.current.importJob?.status).toBe('succeeded');
    expect(onSettled).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_IMPORT_SUCCESS_BANNER_MS);
    });
    expect(result.current.importJob).toBeNull();
  });

  it('keeps a failed job visible', async () => {
    listJobs.mockResolvedValue([job({ status: 'failed', errorMessage: 'Graph timeout' })]);
    const { result } = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    await waitFor(() => {
      expect(result.current.importJob?.status).toBe('failed');
    });
  });

  it('ignores a job for a different Meta channel', async () => {
    listJobs.mockResolvedValue([job({ channel: 'facebook', status: 'processing' })]);
    const { result } = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    await waitFor(() => {
      expect(listJobs).toHaveBeenCalled();
    });
    expect(result.current.importJob).toBeNull();
  });

  it('does not replace a session job with a late list response', async () => {
    let resolveList: (jobs: InboxImportJobSummary[]) => void = () => {};
    listJobs.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        })
    );
    const { result } = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    act(() => {
      result.current.setImportJob(job({ id: 'job-new', status: 'pending' }));
    });
    await act(async () => {
      resolveList([job({ id: 'job-old', status: 'succeeded' })]);
    });
    expect(result.current.importJob?.id).toBe('job-new');
  });
});
