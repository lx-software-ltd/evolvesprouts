'use client';

import { useCallback, useEffect, useState } from 'react';

import { DeleteIcon, RotateIcon, ViewIcon } from '@/components/icons/action-icons';
import { Button } from '@/components/ui/button';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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

interface BulkExpenseImportJobsPanelProps {
  onAfterMutation?: () => void;
}

export function BulkExpenseImportJobsPanel({ onAfterMutation }: BulkExpenseImportJobsPanelProps) {
  const [items, setItems] = useState<BulkImportJobSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailBody, setDetailBody] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
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

  const openView = useCallback(async (jobId: string) => {
    setDetailOpen(true);
    setDetailTitle('Bulk import job');
    setDetailBody('');
    setDetailLoading(true);
    try {
      const { bulkImportJob } = await getAdminBulkExpenseImportJob(jobId);
      const lines = [
        `Status: ${formatEnumLabel(bulkImportJob.status)}`,
        `Created count: ${bulkImportJob.createdCount ?? '—'}`,
      ];
      if (bulkImportJob.errorMessage?.trim()) {
        lines.push(`Message: ${bulkImportJob.errorMessage.trim()}`);
      }
      if (bulkImportJob.expenses?.length) {
        lines.push(`Expenses returned: ${bulkImportJob.expenses.length}`);
      }
      setDetailBody(lines.join('\n'));
    } catch (error) {
      setDetailBody(toErrorMessage(error, 'Could not load job details.'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailTitle('');
    setDetailBody('');
    setDetailLoading(false);
  }, []);

  const startRetry = useCallback((row: BulkImportJobSummary) => {
    setRetryError('');
    setRetryTarget(row);
  }, []);

  const closeRetry = useCallback(() => {
    if (retryBusy) {
      return;
    }
    setRetryTarget(null);
    setRetryError('');
  }, [retryBusy]);

  const startDelete = useCallback((row: BulkImportJobSummary) => {
    setDeleteError('');
    setDeleteTarget(row);
  }, []);

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

  const canRetry = (row: BulkImportJobSummary) =>
    row.status === 'failed' || row.status === 'succeeded_with_errors';

  return (
    <>
      <PaginatedTableCard
        title='Recent combined-PDF imports'
        description={`${totalCount} job${totalCount === 1 ? '' : 's'} for your account (newest first).`}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={Boolean(nextCursor)}
        error={loadError}
        loadingLabel='Loading jobs…'
        onLoadMore={loadMore}
      >
        <div className='overflow-x-auto'>
          <AdminDataTable tableClassName='min-w-[720px]'>
            <AdminDataTableHead>
              <tr>
                <AdminDataTableHeadCell>Started</AdminDataTableHeadCell>
                <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
                <AdminDataTableHeadCell>Created</AdminDataTableHeadCell>
                <AdminDataTableHeadCell>Message</AdminDataTableHeadCell>
                <AdminDataTableOperationsHeadCell />
              </tr>
            </AdminDataTableHead>
            <AdminDataTableBody>
              {!isLoading && items.length === 0 ? (
                <tr>
                  <AdminDataTableCell colSpan={5}>No bulk import jobs yet.</AdminDataTableCell>
                </tr>
              ) : null}
              {items.map((row) => (
                <tr key={row.id}>
                  <AdminDataTableCell className='whitespace-nowrap'>
                    {formatWhen(row.createdAt)}
                  </AdminDataTableCell>
                  <AdminDataTableCell>{formatEnumLabel(row.status)}</AdminDataTableCell>
                  <AdminDataTableCell className='tabular-nums'>
                    {row.createdCount ?? '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='max-w-[280px] truncate text-slate-600'>
                    {row.errorMessage?.trim() || '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='text-right'>
                    <div className='flex flex-wrap justify-end gap-1'>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        aria-label='View result'
                        title='View result'
                        onClick={() => void openView(row.id)}
                      >
                        <ViewIcon className='h-4 w-4' aria-hidden />
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        disabled={!canRetry(row)}
                        aria-label={
                          canRetry(row)
                            ? 'Retry import with the same PDF and vendor defaults'
                            : 'Retry unavailable for this job status'
                        }
                        title={
                          canRetry(row)
                            ? 'Queue a new import using the same PDF and vendor defaults'
                            : 'Retry is only available for failed or partially failed jobs'
                        }
                        onClick={() => startRetry(row)}
                      >
                        <RotateIcon className='h-4 w-4' aria-hidden />
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='danger'
                        aria-label='Delete bulk import job'
                        title='Remove this job from your recent imports list'
                        onClick={() => startDelete(row)}
                      >
                        <DeleteIcon className='h-4 w-4' aria-hidden />
                      </Button>
                    </div>
                  </AdminDataTableCell>
                </tr>
              ))}
            </AdminDataTableBody>
          </AdminDataTable>
        </div>
      </PaginatedTableCard>

      <ConfirmDialog
        open={detailOpen}
        title={detailTitle}
        description={detailLoading ? 'Loading job details…' : 'Current job snapshot.'}
        cancelLabel='Close'
        hideConfirm
        dialogRole='dialog'
        onConfirm={closeDetail}
        onCancel={closeDetail}
      >
        {detailLoading ? null : (
          <pre className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800'>
            {detailBody}
          </pre>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={retryTarget !== null}
        title='Retry bulk import?'
        description='This queues a new background job using the same PDF attachment and default vendor. It does not remove expenses created by earlier attempts.'
        confirmLabel={retryBusy ? 'Queuing…' : 'Queue retry'}
        confirmDisabled={retryBusy}
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
        confirmLabel={deleteBusy ? 'Deleting…' : 'Delete job'}
        confirmDisabled={deleteBusy}
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
