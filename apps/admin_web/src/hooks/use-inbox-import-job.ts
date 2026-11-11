'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { ADMIN_LIST_PAGE_SIZE } from '@/lib/admin-list-query';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import { getAdminQueryClient } from '@/lib/admin-query-client';
import {
  isInboxImportInFlight,
  isInboxImportSuccess,
  listInboxImportJobs,
  type InboxImportJobStatus,
  type InboxImportJobSummary,
} from '@/lib/inbox-import-api';

/**
 * Matches the inbox import worker's default stale window: lambda timeout
 * 600s, times two, plus 120s. Older jobs are not a live banner.
 */
export const INBOX_IMPORT_STALE_MS = (600 * 2 + 120) * 1000;
export const INBOX_IMPORT_POLL_MS = 2_000;
export const INBOX_IMPORT_POLL_HIDDEN_MS = 10_000;
export const INBOX_IMPORT_SUCCESS_BANNER_MS = 20_000;

const SESSION_KEY = 'admin.inboxImport.banner';
const MAX_SESSION_IDS = 20;
const EMPTY_JOBS: InboxImportJobSummary[] = [];

export type InboxImportJobsPath = '/v1/admin/meta/import-jobs' | '/v1/admin/whatsapp/import-jobs';

type SessionState = { watched: string[]; dismissed: string[] };

const EMPTY_SESSION: SessionState = { watched: [], dismissed: [] };

function readSession(): SessionState {
  if (typeof window === 'undefined') {
    return EMPTY_SESSION;
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return EMPTY_SESSION;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return EMPTY_SESSION;
    }
    const record = parsed as { watched?: unknown; dismissed?: unknown };
    return {
      watched: stringIds(record.watched),
      dismissed: stringIds(record.dismissed),
    };
  } catch {
    return EMPTY_SESSION;
  }
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string').slice(-MAX_SESSION_IDS);
}

function writeSession(state: SessionState) {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
}

export function isInboxImportJobStale(job: InboxImportJobSummary, now = Date.now()): boolean {
  const raw = job.updatedAt ?? job.createdAt;
  if (!raw) {
    return true;
  }
  const stamp = Date.parse(raw);
  if (!Number.isFinite(stamp)) {
    return true;
  }
  return now - stamp >= INBOX_IMPORT_STALE_MS;
}

function forChannel(
  jobs: readonly InboxImportJobSummary[],
  channel: string | null | undefined
): InboxImportJobSummary[] {
  if (!channel) {
    return [...jobs];
  }
  return jobs.filter((job) => job.channel === channel);
}

function shouldShow(job: InboxImportJobSummary, session: SessionState, now: number): boolean {
  if (session.dismissed.includes(job.id)) {
    return false;
  }
  if (isInboxImportJobStale(job, now)) {
    return false;
  }
  if (isInboxImportInFlight(job.status) || job.status === 'failed') {
    return true;
  }
  return isInboxImportSuccess(job.status) && session.watched.includes(job.id);
}

function resolveDisplayedJob(
  jobs: readonly InboxImportJobSummary[],
  startedJob: InboxImportJobSummary | null,
  channel: string | null | undefined,
  session: SessionState,
  now: number
): InboxImportJobSummary | null {
  if (startedJob && (!channel || startedJob.channel === channel)) {
    const updated = jobs.find((job) => job.id === startedJob.id) ?? startedJob;
    if (shouldShow(updated, session, now)) {
      return updated;
    }
  }
  return forChannel(jobs, channel).find((job) => shouldShow(job, session, now)) ?? null;
}

function hasLiveJob(
  jobs: readonly InboxImportJobSummary[],
  startedJob: InboxImportJobSummary | null,
  channel: string | null | undefined,
  now: number
): boolean {
  const live = (job: InboxImportJobSummary) =>
    (!channel || job.channel === channel) &&
    isInboxImportInFlight(job.status) &&
    !isInboxImportJobStale(job, now);
  return jobs.some(live) || (startedJob !== null && live(startedJob));
}

function isTerminal(status: InboxImportJobStatus): boolean {
  return isInboxImportSuccess(status) || status === 'failed';
}

function liveJobIds(
  jobs: readonly InboxImportJobSummary[],
  startedJob: InboxImportJobSummary | null,
  channel: string | null | undefined,
  now: number
): string[] {
  const ids = forChannel(jobs, channel)
    .filter((job) => isInboxImportInFlight(job.status) && !isInboxImportJobStale(job, now))
    .map((job) => job.id);
  if (
    startedJob &&
    (!channel || startedJob.channel === channel) &&
    isInboxImportInFlight(startedJob.status) &&
    !isInboxImportJobStale(startedJob, now) &&
    !ids.includes(startedJob.id)
  ) {
    ids.push(startedJob.id);
  }
  return ids;
}

/**
 * Inbox import banner backed by the shared query cache. Restores only a fresh
 * in-flight or failed job, polls until the worker finishes or the job goes
 * stale, and keeps a success outcome for this browser tab until it is dismissed.
 */
export function useInboxImportJob(options: {
  endpointPath: InboxImportJobsPath;
  channel?: string | null;
  onSettled?: (job: InboxImportJobSummary) => void | Promise<unknown>;
  /** When false, an in-flight job polls on the slower hidden interval. */
  visible?: boolean;
}) {
  const { endpointPath, channel, onSettled, visible = true } = options;
  const queryClient = getAdminQueryClient();
  const [session, setSession] = useState<SessionState>(readSession);
  const [startedJob, setStartedJob] = useState<InboxImportJobSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onSettledRef = useRef(onSettled);
  const trackedStatusRef = useRef(new Map<string, InboxImportJobStatus>());
  const shownIdRef = useRef<string | null>(null);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    writeSession(session);
  }, [session]);

  const watch = useCallback((id: string) => {
    setSession((current) => ({
      watched: [...current.watched.filter((item) => item !== id), id].slice(-MAX_SESSION_IDS),
      dismissed: current.dismissed.filter((item) => item !== id),
    }));
  }, []);

  const dismiss = useCallback((id: string) => {
    setSession((current) => ({
      watched: current.watched.filter((item) => item !== id),
      dismissed: [...current.dismissed.filter((item) => item !== id), id].slice(-MAX_SESSION_IDS),
    }));
  }, []);

  const setImportJob = useCallback(
    (job: InboxImportJobSummary | null) => {
      if (!job) {
        setStartedJob(null);
        return;
      }
      watch(job.id);
      setStartedJob(job);
    },
    [watch]
  );

  const query = useQuery(
    {
      queryKey: adminQueryKeys.inboxImportJobs.list(endpointPath, ADMIN_LIST_PAGE_SIZE),
      queryFn: ({ signal }) =>
        listInboxImportJobs(endpointPath, { signal, limit: ADMIN_LIST_PAGE_SIZE }),
      refetchInterval: (current) => {
        const rows = current.state.data ?? EMPTY_JOBS;
        if (!hasLiveJob(rows, startedJob, channel, Date.now())) {
          return false;
        }
        return visible ? INBOX_IMPORT_POLL_MS : INBOX_IMPORT_POLL_HIDDEN_MS;
      },
      refetchIntervalInBackground: true,
    },
    queryClient
  );

  const jobs = query.data ?? EMPTY_JOBS;
  // Remember a live job so its success stays visible after the next poll.
  const watchedIds = new Set(session.watched);
  const dismissedIds = new Set(session.dismissed);
  const unseenLive = liveJobIds(jobs, startedJob, channel, now).filter(
    (id) => !watchedIds.has(id) && !dismissedIds.has(id)
  );
  if (unseenLive.length > 0) {
    setSession((current) => {
      const watched = new Set(current.watched);
      const additions = unseenLive.filter((id) => !watched.has(id));
      if (additions.length === 0) {
        return current;
      }
      return {
        ...current,
        watched: [...current.watched, ...additions].slice(-MAX_SESSION_IDS),
      };
    });
  }
  const importJob = useMemo(
    () => resolveDisplayedJob(jobs, startedJob, channel, session, now),
    [jobs, startedJob, channel, session, now]
  );

  useEffect(() => {
    shownIdRef.current = importJob?.id ?? null;
  }, [importJob]);

  const dismissImportJob = useCallback(() => {
    const id = shownIdRef.current;
    if (id) {
      dismiss(id);
    }
  }, [dismiss]);

  useEffect(() => {
    if (!importJob) {
      return;
    }
    const raw = importJob.updatedAt ?? importJob.createdAt;
    const stamp = raw ? Date.parse(raw) : Number.NaN;
    if (!Number.isFinite(stamp)) {
      return;
    }
    const remaining = INBOX_IMPORT_STALE_MS - (Date.now() - stamp);
    if (remaining <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [importJob]);

  useEffect(() => {
    const seen = new Set<string>();
    for (const row of forChannel(jobs, channel)) {
      seen.add(row.id);
      const previous = trackedStatusRef.current.get(row.id);
      trackedStatusRef.current.set(row.id, row.status);
      if (previous && isInboxImportInFlight(previous) && isTerminal(row.status)) {
        void onSettledRef.current?.(row);
      }
    }
    if (startedJob && !seen.has(startedJob.id) && !trackedStatusRef.current.has(startedJob.id)) {
      trackedStatusRef.current.set(startedJob.id, startedJob.status);
    }
  }, [jobs, startedJob, channel]);

  const shownId = importJob?.id ?? null;
  const shownStatus = importJob?.status ?? null;
  useEffect(() => {
    if (!shownId || shownStatus !== 'succeeded') {
      return;
    }
    const timer = window.setTimeout(() => dismiss(shownId), INBOX_IMPORT_SUCCESS_BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [shownId, shownStatus, dismiss]);

  return { importJob, setImportJob, dismissImportJob };
}
