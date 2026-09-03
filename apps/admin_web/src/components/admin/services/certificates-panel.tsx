'use client';

import { useCallback, useState } from 'react';

import { CertificateDetail } from '@/components/admin/services/certificate-detail';
import { CertificateIssuePanel } from '@/components/admin/services/certificate-issue-panel';
import { DeleteIcon, DownloadIcon, VoidExpenseIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { toErrorMessage } from '@/hooks/hook-errors';
import { useCertificateIssueDraft } from '@/hooks/use-certificate-issue-draft';
import type { useCompletionCertificates } from '@/hooks/use-completion-certificates';
import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import { getCompletionCertificatePdfDownload, type CompletionCertificate } from '@/lib/completion-certificates-api';
import { formatDate, formatEnumLabel } from '@/lib/format';
import type { ServiceSummary } from '@/types/services';

/** Query parameter that mirrors the expanded certificate row (`?certificate=<id>` or `?certificate=new`). */
export const ADMIN_CERTIFICATE_QUERY_PARAM = 'certificate';

const COLUMN_COUNT = 7;

export interface CertificatesPanelProps {
  certificates: ReturnType<typeof useCompletionCertificates>;
  serviceOptions: ServiceSummary[];
}

/**
 * Table-first issued certificates: `Issue certificate` opens a draft row with
 * the issue form and live preview; existing rows expand into a read-only
 * record. Download, Void, and Delete live in the Operations column.
 */
export function CertificatesPanel({ certificates, serviceOptions }: CertificatesPanelProps) {
  const {
    certificates: rows,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    isSaving,
    error,
    hasMore,
    loadMore,
    issueCertificate,
    voidCertificate,
    deleteCertificate,
  } = certificates;

  const { confirmDialogProps, requestConfirm, deleteActionError, setDeleteActionError, expanded, clearDirty, track } =
    useEntityPanelEditorShell({ paramName: ADMIN_CERTIFICATE_QUERY_PARAM });
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const draft = useCertificateIssueDraft({
    track,
    issueCertificate,
    onIssued: () => {
      clearDirty();
      expanded.collapse();
    },
  });
  const resetDraft = draft.reset;
  const reset = useCallback(() => {
    resetDraft();
    clearDirty();
  }, [clearDirty, resetDraft]);
  const applyRow = useCallback(() => {
    resetDraft();
    clearDirty();
  }, [clearDirty, resetDraft]);
  useExpandedRecordForm<CompletionCertificate>({
    expandedId: expanded.expandedId,
    rows,
    isLoading,
    applyRow,
    reset,
    collapse: expanded.collapse,
  });

  async function runRowAction(row: CompletionCertificate, action: () => Promise<unknown>, fallback: string) {
    setDeleteActionError('');
    setBusyRowId(row.id);
    try {
      await action();
    } catch (caught) {
      setDeleteActionError(toErrorMessage(caught, fallback));
    } finally {
      setBusyRowId(null);
    }
  }

  async function handleDownloadRow(row: CompletionCertificate) {
    await runRowAction(
      row,
      async () => {
        const { downloadUrl } = await getCompletionCertificatePdfDownload(row.id);
        window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      },
      'Could not download certificate.'
    );
  }

  async function handleVoidRow(row: CompletionCertificate) {
    const ok = await requestConfirm({
      title: 'Void certificate?',
      description: `Void the certificate for ${row.recipient_display_name}? The contact will no longer show the award badge.`,
      confirmLabel: 'Void',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }
    await runRowAction(row, () => voidCertificate(row.id), 'Could not void certificate.');
  }

  async function handleDeleteRow(row: CompletionCertificate) {
    const ok = await requestConfirm({
      title: 'Delete certificate?',
      description: `Permanently delete the certificate record for ${row.recipient_display_name}?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }
    await runRowAction(
      row,
      async () => {
        await deleteCertificate(row.id);
        if (expanded.isExpanded(row.id)) {
          expanded.collapse();
        }
      },
      'Could not delete certificate.'
    );
  }

  const listError = [error, deleteActionError].filter(Boolean).join(' • ');

  return (
    <>
      <ConfirmDialog {...confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Certificates'
        columnCount={COLUMN_COUNT}
        rowCount={rows.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        error={listError}
        errorTitle='Certificates'
        emptyLabel='No certificates match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='Issue certificate'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Status' htmlFor='cert-filter-status'>
              <Select
                id='cert-filter-status'
                value={filters.status}
                onChange={(e) => setFilter('status', e.target.value as typeof filters.status)}
              >
                <option value=''>All</option>
                <option value='issued'>Issued</option>
                <option value='voided'>Voided</option>
              </Select>
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Recipient</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Program</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Instance</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Participation</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Status</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new certificate'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New certificate</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={<CertificateIssuePanel draft={draft} serviceOptions={serviceOptions} isSaving={isSaving} />}
          />
        ) : null}
        {rows.map((row) => {
          const isOpen = expanded.isExpanded(row.id);
          const isIssued = row.status === 'issued';
          const isBusy = isSaving || busyRowId === row.id;
          const statusLabel = formatEnumLabel(row.status);
          const participationLabel = formatDate(row.participation_date);
          return (
            <AdminExpandableRow
              key={row.id}
              id={row.id}
              label={`certificate for ${row.recipient_display_name}`}
              expanded={isOpen}
              onToggle={() => expanded.toggle(row.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {row.recipient_display_name}
                    <AdminDataTableCellMeta>
                      {row.program_title} · {participationLabel} · {statusLabel}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {row.program_title}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {row.instance_label}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {participationLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {statusLabel}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'download',
                      label: 'Download certificate PDF',
                      icon: <DownloadIcon className='h-4 w-4' />,
                      hidden: !isIssued,
                      disabled: isBusy,
                      onClick: () => void handleDownloadRow(row),
                    },
                    {
                      key: 'void',
                      label: 'Void certificate',
                      icon: <VoidExpenseIcon className='h-4 w-4' />,
                      tone: 'danger',
                      hidden: !isIssued,
                      disabled: isBusy,
                      onClick: () => void handleVoidRow(row),
                    },
                    {
                      key: 'delete',
                      label: 'Delete certificate',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isBusy,
                      onClick: () => void handleDeleteRow(row),
                    },
                  ]}
                />
              }
              detail={isOpen ? <CertificateDetail certificate={row} /> : null}
            />
          );
        })}
      </AdminRecordTable>
    </>
  );
}
