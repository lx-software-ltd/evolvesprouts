'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isInboxImportInFlight,
  isInboxImportSuccess,
  listInboxImportJobs,
  type InboxImportJobSummary,
} from '@/lib/inbox-import-api';

export const INBOX_IMPORT_SUCCESS_BANNER_MS = 6000;
export const INBOX_IMPORT_POLL_MS = 2000;

export type InboxImportJobsPath = '/v1/admin/meta/import-jobs' | '/v1/admin/whatsapp/import-jobs';

function pickJob(
  jobs: InboxImportJobSummary[],
  channel: string | null | undefined
): InboxImportJobSummary | null {
  if (channel) {
    return jobs.find((job) => job.channel === channel) ?? null;
  }
  return jobs[0] ?? null;
}

function shouldRestoreOnLoad(job: InboxImportJobSummary): boolean {
  return isInboxImportInFlight(job.status) || job.status === 'failed';
}

/**
 * Latest inbox import banner: restore in-flight or failed jobs, poll until the
 * worker finishes, then drop a success banner after a short delay so it does
 * not stick around as a permanent green box.
 */
export function useInboxImportJob(options: {
  endpointPath: InboxImportJobsPath;
  channel?: string | null;
  onSettled?: (job: InboxImportJobSummary) => void | Promise<unknown>;
}) {
  const { endpointPath, channel, onSettled } = options;
  const [importJob, setImportJobState] = useState<InboxImportJobSummary | null>(null);
  const onSettledRef = useRef(onSettled);
  const settledJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const setImportJob = useCallback((job: InboxImportJobSummary | null) => {
    if (job === null) {
      setImportJobState(null);
      return;
    }
    settledJobIdRef.current = null;
    setImportJobState(job);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listInboxImportJobs(endpointPath)
      .then((jobs) => {
        if (cancelled) {
          return;
        }
        setImportJobState((current) => {
          if (current) {
            return current;
          }
          const job = pickJob(jobs, channel);
          if (!job || !shouldRestoreOnLoad(job)) {
            return null;
          }
          return job;
        });
      })
      .catch(() => {
        // Keep whatever the session already shows.
      });
    return () => {
      cancelled = true;
    };
  }, [endpointPath, channel]);

  const jobId = importJob?.id ?? null;
  const inFlight = importJob !== null && isInboxImportInFlight(importJob.status);

  useEffect(() => {
    if (!jobId || !inFlight) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const jobs = await listInboxImportJobs(endpointPath);
        if (cancelled) {
          return;
        }
        const next = jobs.find((job) => job.id === jobId);
        if (next) {
          setImportJobState(next);
        }
      } catch {
        // Keep the last known status; the next poll retries.
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, INBOX_IMPORT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, inFlight, endpointPath]);

  useEffect(() => {
    if (!importJob) {
      return;
    }
    const isTerminal = isInboxImportSuccess(importJob.status) || importJob.status === 'failed';
    if (!isTerminal) {
      return;
    }
    if (settledJobIdRef.current !== importJob.id) {
      settledJobIdRef.current = importJob.id;
      void onSettledRef.current?.(importJob);
    }
    if (!isInboxImportSuccess(importJob.status)) {
      return;
    }
    const timer = window.setTimeout(() => {
      setImportJobState((current) => (current?.id === importJob.id ? null : current));
    }, INBOX_IMPORT_SUCCESS_BANNER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [importJob]);

  return { importJob, setImportJob };
}
