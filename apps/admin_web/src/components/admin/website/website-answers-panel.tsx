'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AdminPageErrorBanner } from '@/components/admin/admin-page-error-banner';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminReadOnlyValue } from '@/components/ui/admin-read-only-value';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { toErrorMessage } from '@/hooks/hook-errors';
import { useExpandedRecord } from '@/hooks/use-expanded-record';
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

// Read-only rows: expand column + five data columns, no Operations column.
const COLUMN_COUNT = 6;

function answerRowId(row: WebsiteAnswersRow): string {
  return `${row.sessionId}:${row.questionId}`;
}

/**
 * Stored answers for one form or poll as a table-first, read-only record
 * table: the form/poll picker is the only filter, `Export answers` and
 * `Clear answers` are table-scoped tools in the filter bar's trailing slot,
 * and each row expands into the full answer on the field grid.
 */
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
  const expanded = useExpandedRecord({ paramName: `${lowerNoun}-answer` });

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
      expanded.collapse();
      await loadSummaries();
      await refetch({ slug: selectedSlug });
    } catch (error) {
      setActionError(toErrorMessage(error, `Failed to clear ${lowerNoun} answers.`));
    } finally {
      setClearing(false);
    }
  };

  const storedCount = selectedSummary?.answerCount ?? 0;
  const isFirstLoad = summariesLoading || (answersLoading && answers.length === 0);

  return (
    <div className='space-y-4'>
      {summariesError ? <AdminPageErrorBanner title={`${titleNoun}s`} message={summariesError} /> : null}
      {actionError ? <AdminPageErrorBanner title={`${titleNoun} action`} message={actionError} /> : null}

      <AdminRecordTable
        aria-label={`${titleNoun} answers`}
        columnCount={COLUMN_COUNT}
        rowCount={answers.length}
        isLoading={isFirstLoad}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        error={answersError}
        errorTitle={`${titleNoun} answers`}
        emptyLabel={
          selectedSlug ? `No answers stored for this ${lowerNoun} yet.` : `No ${lowerNoun}s found.`
        }
        filters={
          <AdminFilterBar
            summary={
              selectedSummary
                ? `${selectedSummary.answerCount} stored answer rows for ${selectedSummary.slug}.`
                : undefined
            }
            trailing={
              <>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => void handleExport()}
                  disabled={!selectedSlug || answersLoading}
                  loading={exporting}
                  loadingLabel='Exporting…'
                >
                  Export answers
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => setClearDialogOpen(true)}
                  disabled={!selectedSlug || clearing || answersLoading || storedCount === 0}
                >
                  Clear answers
                </Button>
              </>
            }
          >
            <AdminFilterField label={titleNoun} htmlFor={`website-${lowerNoun}s-select`} className='sm:basis-72'>
              <Select
                id={`website-${lowerNoun}s-select`}
                value={selectedSlug}
                onChange={(event) => {
                  expanded.collapse();
                  setSelectedSlug(event.target.value);
                }}
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
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Session</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Question</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Type</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Answer</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Updated</AdminDataTableHeadCell>
          </tr>
        }
      >
        {answers.map((row) => {
          const id = answerRowId(row);
          const isOpen = expanded.isExpanded(id);
          const answerText = formatAnswer(row);
          const updatedLabel = formatDate(row.updatedAt);
          return (
            <AdminExpandableRow
              key={id}
              id={id}
              label={`${row.questionId} answer from session ${row.sessionId}`}
              expanded={isOpen}
              onToggle={() => expanded.toggle(id)}
              columnCount={COLUMN_COUNT}
              autoFocusDetail={false}
              cells={
                <>
                  <AdminDataTableCell className='font-mono text-xs text-slate-900'>
                    {row.sessionId}
                    <AdminDataTableCellMeta>
                      {row.questionId} · {answerText}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {row.questionId}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {row.questionType}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    <span className='line-clamp-2 wrap-anywhere'>{answerText}</span>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {updatedLabel}
                  </AdminDataTableCell>
                </>
              }
              detail={
                isOpen ? (
                  <AdminEditorPanel>
                    <AdminFieldGrid columns={4}>
                      <AdminReadOnlyValue label='Session' mono>
                        {row.sessionId}
                      </AdminReadOnlyValue>
                      <AdminReadOnlyValue label='Question' mono>
                        {row.questionId}
                      </AdminReadOnlyValue>
                      <AdminReadOnlyValue label='Type'>{row.questionType}</AdminReadOnlyValue>
                      <AdminReadOnlyValue label='Updated'>{updatedLabel}</AdminReadOnlyValue>
                    </AdminFieldGrid>
                    <AdminFieldGrid columns={1}>
                      <AdminReadOnlyValue label='Answer'>
                        <span className='wrap-anywhere whitespace-pre-wrap'>{answerText}</span>
                      </AdminReadOnlyValue>
                    </AdminFieldGrid>
                  </AdminEditorPanel>
                ) : null
              }
            />
          );
        })}
      </AdminRecordTable>

      <ConfirmDialog
        open={clearDialogOpen}
        title={`Clear ${lowerNoun} answers`}
        description={
          selectedSlug
            ? `Permanently delete all ${storedCount} stored answer rows for "${selectedSlug}"? This cannot be undone.`
            : `Permanently delete all stored answer rows for this ${lowerNoun}? This cannot be undone.`
        }
        confirmLabel='Clear answers'
        cancelLabel='Cancel'
        variant='danger'
        confirmLoading={clearing}
        confirmLoadingLabel='Clearing…'
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
