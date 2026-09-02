'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AdminPageErrorBanner } from '@/components/admin/admin-page-error-banner';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
} from '@/components/ui/admin-data-table';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { Select } from '@/components/ui/select';
import { toErrorMessage } from '@/hooks/hook-errors';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { formatDate } from '@/lib/format';

export interface WebsiteAnswersSummary {
  slug: string;
  answerCount: number;
}

export interface WebsiteAnswersRow {
  sessionId: string;
  questionId: string;
  questionType: string;
  updatedAt: string;
}

export interface WebsiteAnswersPageParams {
  cursor: string | null;
  limit: number;
  signal: AbortSignal;
}

export interface WebsiteAnswersPanelProps<TRow extends WebsiteAnswersRow> {
  noun: 'form' | 'poll';
  listSummaries: (signal?: AbortSignal) => Promise<WebsiteAnswersSummary[]>;
  listAnswers: (
    slug: string,
    params: WebsiteAnswersPageParams
  ) => Promise<{ items: TRow[]; nextCursor: string | null }>;
  exportCsv: (slug: string) => Promise<Blob>;
  clearAnswers: (slug: string) => Promise<void>;
  formatAnswer: (row: TRow) => string;
}

type AnswerFilters = {
  slug: string;
};

export function WebsiteAnswersPanel<TRow extends WebsiteAnswersRow>({
  noun,
  listSummaries,
  listAnswers,
  exportCsv,
  clearAnswers,
  formatAnswer,
}: WebsiteAnswersPanelProps<TRow>) {
  const titleNoun = noun === 'form' ? 'Form' : 'Poll';
  const lowerNoun = noun;
  const [summaries, setSummaries] = useState<WebsiteAnswersSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [summariesError, setSummariesError] = useState('');
  const [actionError, setActionError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const selectedSummary = useMemo(
    () => summaries.find((item) => item.slug === selectedSlug) ?? null,
    [summaries, selectedSlug]
  );

  const fetcher = useCallback(
    async (params: AnswerFilters & WebsiteAnswersPageParams) => {
      if (!params.slug) {
        return { items: [] as TRow[], nextCursor: null };
      }
      return listAnswers(params.slug, {
        cursor: params.cursor,
        limit: params.limit,
        signal: params.signal,
      });
    },
    [listAnswers]
  );

  const {
    items: answers,
    isLoading: answersLoading,
    isLoadingMore,
    hasMore,
    error: answersError,
    loadMore,
    refetch,
  } = usePaginatedList<TRow, AnswerFilters>({
    fetcher,
    defaultFilters: { slug: '' },
    errorPrefix: `Failed to load ${lowerNoun} answers`,
    fetchOnMount: false,
  });

  const loadSummaries = useCallback(
    async (signal?: AbortSignal) => {
      setSummariesLoading(true);
      setSummariesError('');
      try {
        const items = await listSummaries(signal);
        setSummaries(items);
        setSelectedSlug((current) => {
          if (current && items.some((item) => item.slug === current)) {
            return current;
          }
          return items[0]?.slug ?? '';
        });
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        setSummariesError(toErrorMessage(error, `Failed to load ${lowerNoun}s.`));
      } finally {
        if (!signal?.aborted) {
          setSummariesLoading(false);
        }
      }
    },
    [listSummaries, lowerNoun]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSummaries(controller.signal);
    return () => controller.abort();
  }, [loadSummaries]);

  useEffect(() => {
    void refetch({ slug: selectedSlug });
  }, [refetch, selectedSlug]);

  const handleExport = async () => {
    if (!selectedSlug) {
      return;
    }
    setActionError('');
    setExporting(true);
    try {
      const blob = await exportCsv(selectedSlug);
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${lowerNoun}-${selectedSlug}-answers-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setActionError(toErrorMessage(error, `Failed to export ${lowerNoun} answers.`));
    } finally {
      setExporting(false);
    }
  };

  const handleClearConfirm = async () => {
    if (!selectedSlug) {
      return;
    }
    setActionError('');
    setClearing(true);
    try {
      await clearAnswers(selectedSlug);
      setClearDialogOpen(false);
      await loadSummaries();
      await refetch({ slug: selectedSlug });
    } catch (error) {
      setActionError(toErrorMessage(error, `Failed to clear ${lowerNoun} answers.`));
    } finally {
      setClearing(false);
    }
  };

  const storedCount = selectedSummary?.answerCount ?? 0;

  const toolbar = (
    <div className='mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
      <div className='min-w-[240px] max-w-md flex-1'>
        <Label htmlFor={`website-${lowerNoun}s-select`}>{titleNoun}</Label>
        <Select
          id={`website-${lowerNoun}s-select`}
          value={selectedSlug}
          onChange={(event) => setSelectedSlug(event.target.value)}
          disabled={summariesLoading || summaries.length === 0}
        >
          {summaries.length === 0 ? (
            <option value=''>No {lowerNoun}s found</option>
          ) : (
            summaries.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.slug} ({item.answerCount} answers)
              </option>
            ))
          )}
        </Select>
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          onClick={() => void handleExport()}
          disabled={!selectedSlug || exporting || answersLoading}
        >
          {exporting ? 'Exporting…' : 'Export answers'}
        </Button>
        <Button
          type='button'
          variant='outline'
          onClick={() => setClearDialogOpen(true)}
          disabled={!selectedSlug || clearing || answersLoading || storedCount === 0}
        >
          Clear answers
        </Button>
      </div>
    </div>
  );

  return (
    <div className='space-y-4'>
      {summariesError ? <AdminPageErrorBanner title={`${titleNoun}s`} message={summariesError} /> : null}
      {actionError ? (
        <AdminPageErrorBanner title={`${titleNoun} action`} message={actionError} />
      ) : null}

      <PaginatedTableCard
        title={`${titleNoun} answers`}
        description={
          selectedSummary
            ? `${selectedSummary.answerCount} stored answer rows for ${selectedSummary.slug}.`
            : `Choose a ${lowerNoun} to view stored answers from DynamoDB.`
        }
        isLoading={answersLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={answersError}
        loadingLabel='Loading answers…'
        onLoadMore={loadMore}
        toolbar={toolbar}
      >
        <AdminDataTable tableClassName='min-w-[960px]'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Session</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Question</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Type</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Answer</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Updated</AdminDataTableHeadCell>
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {!answersLoading && answers.length === 0 ? (
              <tr>
                <AdminDataTableCell colSpan={5} className='text-slate-500'>
                  {selectedSlug
                    ? `No answers stored for this ${lowerNoun} yet.`
                    : `Select a ${lowerNoun} to load answers.`}
                </AdminDataTableCell>
              </tr>
            ) : (
              answers.map((row) => (
                <tr key={`${row.sessionId}-${row.questionId}`}>
                  <AdminDataTableCell className='font-mono text-xs'>{row.sessionId}</AdminDataTableCell>
                  <AdminDataTableCell>{row.questionId}</AdminDataTableCell>
                  <AdminDataTableCell>{row.questionType}</AdminDataTableCell>
                  <AdminDataTableCell>{formatAnswer(row)}</AdminDataTableCell>
                  <AdminDataTableCell>{formatDate(row.updatedAt)}</AdminDataTableCell>
                </tr>
              ))
            )}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>

      <ConfirmDialog
        open={clearDialogOpen}
        title={`Clear ${lowerNoun} answers`}
        description={
          selectedSlug
            ? `Permanently delete all ${storedCount} stored answer rows for "${selectedSlug}"? This cannot be undone.`
            : `Permanently delete all stored answer rows for this ${lowerNoun}? This cannot be undone.`
        }
        confirmLabel={clearing ? 'Clearing…' : 'Clear answers'}
        cancelLabel='Cancel'
        variant='danger'
        confirmDisabled={clearing}
        onConfirm={() => void handleClearConfirm()}
        onCancel={() => {
          if (!clearing) {
            setClearDialogOpen(false);
          }
        }}
      />
    </div>
  );
}
