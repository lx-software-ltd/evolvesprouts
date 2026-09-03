'use client';

import { useCallback, useEffect, useState } from 'react';

import { DeleteIcon, RotateIcon } from '@/components/icons/action-icons';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { toErrorMessage } from '@/hooks/hook-errors';
import {
  deleteAdminBulkExpenseImportJob,
  getAdminBulkExpenseImportJob,
  listAdminBulkExpenseImportJobs,
  queueAdminBulkExpenseImportJob,
  type BulkImportJobSummary,
} from '@/lib/expenses-api';
import { ADMIN_LIST_PAGE_SIZE } from '@/lib/admin-list-query';
import { formatEnumLabel } from '@/lib/format';

const COLUMN_COUNT = 6;

function formatWhen(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) {
    return '—';
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return trimmed;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(parsed));
}

function canRetry(row: BulkImportJobSummary): boolean {
  return row.status === 'failed' || row.status === 'succeeded_with_errors';
}

interface JobDetail {
  status: string;
  createdCount: string;
  message: string;
  expensesReturned: string;
}

/**
 * Read-only snapshot of one job, fetched when its row opens. Mount it with
 * `key={jobId}` so a different job starts from a fresh loading state.
 */
function BulkImportJobDetail({ jobId }: { jobId: string }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { bulkImportJob } = await getAdminBulkExpenseImportJob(jobId);
        if (cancelled) {
          return;
        }
        setDetail({
          status: formatEnumLabel(bulkImportJob.status),
          createdCount: bulkImportJob.createdCount === null ? '—' : String(bulkImportJob.createdCount),
          message: bulkImportJob.errorMessage?.trim() || '—',
          expensesReturned: String(bulkImportJob.expenses?.length ?? 0),
        });
      } catch (caught) {
        if (!cancelled) {
          setError(toErrorMessage(caught, 'Could not load job details.'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (error) {
    return <AdminInlineError>{error}</AdminInlineError>;
  }
  const loading = detail === null;
  return (
    <AdminEditorPanel>
      <AdminFieldGrid columns={4}>
        <AdminField label='Status' htmlFor={`bulk-job-${jobId}-status`}>
          <Input id={`bulk-job-${jobId}-status`} readOnly value={loading ? 'Loading…' : detail.status} />
        </AdminField>
        <AdminField label='Expenses created' htmlFor={`bulk-job-${jobId}-created`}>
          <Input id={`bulk-job-${jobId}-created`} readOnly value={loading ? '…' : detail.createdCount} />
        </AdminField>
        <AdminField label='Expenses returned' htmlFor={`bulk-job-${jobId}-returned`}>
          <Input id={`bulk-job-${jobId}-returned`} readOnly value={loading ? '…' : detail.expensesReturned} />
        </AdminField>
        <AdminField label='Job id' htmlFor={`bulk-job-${jobId}-id`}>
          <Input id={`bulk-job-${jobId}-id`} readOnly value={jobId} className='font-mono text-xs' />
        </AdminField>
      </AdminFieldGrid>
      <AdminFieldGrid columns={1}>
        <AdminField label='Message' htmlFor={`bulk-job-${jobId}-message`}>
          <Input id={`bulk-job-${jobId}-message`} readOnly value={loading ? '…' : detail.message} />
        </AdminField>
      </AdminFieldGrid>
    </AdminEditorPanel>
  );
}

interface BulkExpenseImportJobsPanelProps {
  onAfterMutation?: () => void;
}

/**
 * Recent combined-PDF import jobs as a nested record table: a row opens to
 * show the job snapshot; Retry and Delete live in the Operations column.
 */
export function BulkExpenseImportJobsPanel({ onAfterMutation }: BulkExpenseImportJobsPanelProps) {
  const [items, setItems] = useState<BulkImportJobSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<BulkImportJobSummary | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BulkImportJobSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadFirstPage = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const page = await listAdminBulkExpenseImportJobs({ limit: ADMIN_LIST_PAGE_SIZE });
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setTotalCount(page.totalCount);
    } catch (error) {
      setLoadError(toErrorMessage(error, 'Failed to load bulk import jobs.'));
      setItems([]);
      setNextCursor(null);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    setLoadError('');
    try {
      const page = await listAdminBulkExpenseImportJobs({
        cursor: nextCursor,
        limit: ADMIN_LIST_PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
      setTotalCount(page.totalCount);
    } catch (error) {
      setLoadError(toErrorMessage(error, 'Failed to load more jobs.'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, nextCursor]);

  const closeRetry = useCallback(() => {
    if (retryBusy) {
      return;
    }
    setRetryTarget(null);
    setRetryError('');
  }, [retryBusy]);

  const closeDelete = useCallback(() => {
    if (deleteBusy) {
      return;
    }
    setDeleteTarget(null);
    setDeleteError('');
  }, [deleteBusy]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await deleteAdminBulkExpenseImportJob(deleteTarget.id);
      setDeleteTarget(null);
      setExpandedJobId((current) => (current === deleteTarget.id ? null : current));
      await loadFirstPage();
      onAfterMutation?.();
    } catch (error) {
      setDeleteError(toErrorMessage(error, 'Delete failed.'));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget, loadFirstPage, onAfterMutation]);

  const confirmRetry = useCallback(async () => {
    if (!retryTarget) {
      return;
    }
    setRetryBusy(true);
    setRetryError('');
    try {
      await queueAdminBulkExpenseImportJob({
        attachmentAssetId: retryTarget.attachmentAssetId,
        defaultVendorId: retryTarget.defaultVendorId,
        status: retryTarget.expenseStatus,
      });
      setRetryTarget(null);
      await loadFirstPage();
      onAfterMutation?.();
    } catch (error) {
      setRetryError(toErrorMessage(error, 'Retry failed.'));
    } finally {
      setRetryBusy(false);
    }
  }, [loadFirstPage, onAfterMutation, retryTarget]);

  return (
    <>
      <AdminRecordTable
        embedded
        aria-label='Recent combined-PDF imports'
        columnCount={COLUMN_COUNT}
        rowCount={items.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={Boolean(nextCursor)}
        onLoadMore={loadMore}
        error={loadError}
        errorTitle='Bulk import jobs'
        emptyLabel='No bulk import jobs yet.'
        footer={totalCount > 0 ? `${totalCount} job${totalCount === 1 ? '' : 's'}, newest first` : null}
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Started</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Created</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Message</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {items.map((row) => {
          const isOpen = expandedJobId === row.id;
          return (
            <AdminExpandableRow
              key={row.id}
              id={`bulk-job-${row.id}`}
              label={`import started ${formatWhen(row.createdAt)}`}
              expanded={isOpen}
              onToggle={() => setExpandedJobId(isOpen ? null : row.id)}
              columnCount={COLUMN_COUNT}
              autoFocusDetail={false}
              cells={
                <>
                  <AdminDataTableCell className='text-slate-900'>
                    {formatWhen(row.createdAt)}
                    <AdminDataTableCellMeta>
                      {row.createdCount ?? '—'} created
                      {row.errorMessage?.trim() ? ` · ${row.errorMessage.trim()}` : ''}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell>{formatEnumLabel(row.status)}</AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='tabular-nums'>
                    {row.createdCount ?? '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-600'>
                    <span className='line-clamp-2 wrap-anywhere'>{row.errorMessage?.trim() || '—'}</span>
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'retry',
                      label: 'Retry import with the same PDF and vendor defaults',
                      icon: <RotateIcon className='h-4 w-4' aria-hidden />,
                      hidden: !canRetry(row),
                      onClick: () => {
                        setRetryError('');
                        setRetryTarget(row);
                      },
                    },
                    {
                      key: 'delete',
                      label: 'Delete bulk import job',
                      icon: <DeleteIcon className='h-4 w-4' aria-hidden />,
                      tone: 'danger',
                      onClick: () => {
                        setDeleteError('');
                        setDeleteTarget(row);
                      },
                    },
                  ]}
                />
              }
              detail={isOpen ? <BulkImportJobDetail key={row.id} jobId={row.id} /> : null}
            />
          );
        })}
      </AdminRecordTable>

      <ConfirmDialog
        open={retryTarget !== null}
        title='Retry bulk import?'
        description='This queues a new background job using the same PDF attachment and default vendor. It does not remove expenses created by earlier attempts.'
        confirmLabel='Queue retry'
        confirmLoading={retryBusy}
        confirmLoadingLabel='Queuing…'
        cancelLabel='Cancel'
        variant='default'
        onConfirm={() => void confirmRetry()}
        onCancel={closeRetry}
        dialogRole='dialog'
      >
        {retryError ? <AdminInlineError className='mt-2'>{retryError}</AdminInlineError> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title='Delete bulk import job?'
        description='This removes the job from your recent imports list. Expenses already created from this import are not deleted.'
        confirmLabel='Delete job'
        confirmLoading={deleteBusy}
        confirmLoadingLabel='Deleting…'
        cancelLabel='Cancel'
        variant='danger'
        onConfirm={() => void confirmDelete()}
        onCancel={closeDelete}
        dialogRole='alertdialog'
      >
        {deleteError ? <AdminInlineError className='mt-2'>{deleteError}</AdminInlineError> : null}
      </ConfirmDialog>
    </>
  );
}
