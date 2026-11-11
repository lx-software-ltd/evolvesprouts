import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INBOX_IMPORT_POLL_HIDDEN_MS,
  INBOX_IMPORT_POLL_MS,
  INBOX_IMPORT_STALE_MS,
  INBOX_IMPORT_SUCCESS_BANNER_MS,
  useInboxImportJob,
} from '@/hooks/use-inbox-import-job';
import { ADMIN_LIST_PAGE_SIZE } from '@/lib/admin-list-query';
import { listInboxImportJobs, type InboxImportJobSummary } from '@/lib/inbox-import-api';

vi.mock('@/lib/inbox-import-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/inbox-import-api')>('@/lib/inbox-import-api');
  return {
    ...actual,
    listInboxImportJobs: vi.fn(),
  };
});

const listJobs = vi.mocked(listInboxImportJobs);

function iso(offsetMs = 0): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function job(overrides: Partial<InboxImportJobSummary> = {}): InboxImportJobSummary {
  const stamp = iso();
  return {
    id: 'job-1',
    kind: 'meta_graph',
    channel: 'instagram',
    attachmentAssetId: null,
    status: 'pending',
    errorMessage: null,
    counters: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function staleStamp(): string {
  return iso(INBOX_IMPORT_STALE_MS + 1_000);
}

describe('useInboxImportJob', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    listJobs.mockReset();
    window.sessionStorage.clear();
  });

  it('does not restore a succeeded job from another visit', async () => {
    listJobs.mockResolvedValue([job({ status: 'succeeded' })]);
    const { result } = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    await waitFor(() => {
      expect(listJobs).toHaveBeenCalledWith(
        '/v1/admin/meta/import-jobs',
        expect.objectContaining({ limit: ADMIN_LIST_PAGE_SIZE })
      );
    });
    expect(result.current.importJob).toBeNull();
  });

  it('does not restore a stuck or old failed job', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stamp = staleStamp();
    listJobs.mockResolvedValue([
      job({ status: 'processing', createdAt: stamp, updatedAt: stamp }),
      job({ id: 'job-old-fail', status: 'failed', createdAt: stamp, updatedAt: stamp }),
    ]);
    const { result } = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    await waitFor(() => {
      expect(listJobs).toHaveBeenCalled();
    });
    expect(result.current.importJob).toBeNull();
    const calls = listJobs.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_IMPORT_POLL_HIDDEN_MS);
    });
    expect(listJobs.mock.calls.length).toBe(calls);
  });

  it('restores a recent failure without reloading conversations', async () => {
    listJobs.mockResolvedValue([job({ status: 'failed', errorMessage: 'Graph timeout' })]);
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useInboxImportJob({
        endpointPath: '/v1/admin/meta/import-jobs',
        channel: 'instagram',
        onSettled,
      })
    );
    await waitFor(() => {
      expect(result.current.importJob?.status).toBe('failed');
    });
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('polls an in-flight job, settles once, then hides a clean success', async () => {
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

    const callsAtSuccess = listJobs.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_IMPORT_SUCCESS_BANNER_MS);
    });
    expect(result.current.importJob).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(listJobs.mock.calls.length).toBe(callsAtSuccess);
  });

  it('keeps a skipped import until it is dismissed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listJobs.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    act(() => {
      result.current.setImportJob(job({ status: 'succeeded_with_errors' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_IMPORT_SUCCESS_BANNER_MS);
    });
    expect(result.current.importJob?.status).toBe('succeeded_with_errors');

    act(() => {
      result.current.dismissImportJob();
    });
    expect(result.current.importJob).toBeNull();
  });

  it('shows a watched success again after the tab remounts, until dismiss', async () => {
    listJobs.mockResolvedValue([job({ status: 'processing' })]);
    const first = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    act(() => {
      first.result.current.setImportJob(job({ status: 'processing' }));
    });
    first.unmount();

    listJobs.mockResolvedValue([job({ status: 'succeeded' })]);
    const second = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    await waitFor(() => {
      expect(second.result.current.importJob?.status).toBe('succeeded');
    });

    act(() => {
      second.result.current.dismissImportJob();
    });
    second.unmount();
    const third = renderHook(() =>
      useInboxImportJob({ endpointPath: '/v1/admin/meta/import-jobs', channel: 'instagram' })
    );
    await waitFor(() => {
      expect(listJobs.mock.calls.length).toBeGreaterThan(1);
    });
    expect(third.result.current.importJob).toBeNull();
  });

  it('polls a collapsed panel on the slower interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listJobs.mockResolvedValue([job({ status: 'processing' })]);
    const { result } = renderHook(() =>
      useInboxImportJob({
        endpointPath: '/v1/admin/whatsapp/import-jobs',
        visible: false,
      })
    );
    await waitFor(() => {
      expect(result.current.importJob?.status).toBe('processing');
    });
    const callsAfterLoad = listJobs.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_IMPORT_POLL_MS);
    });
    expect(listJobs.mock.calls.length).toBe(callsAfterLoad);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_IMPORT_POLL_HIDDEN_MS);
    });
    expect(listJobs.mock.calls.length).toBeGreaterThan(callsAfterLoad);
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
