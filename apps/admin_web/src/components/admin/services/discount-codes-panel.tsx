'use client';

import { useMemo, useState } from 'react';

import { DiscountCodeEditorPanel } from '@/components/admin/services/discount-code-editor-panel';
import { ReferralLinkQrDialog } from '@/components/admin/services/referral-link-qr-dialog';
import { CheckIcon, CopyIcon, DeleteIcon, QrLinkIcon } from '@/components/icons/action-icons';
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
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useCopyFeedback } from '@/hooks/use-copy-feedback';
import { useDiscountCodeEditor } from '@/hooks/use-discount-code-editor';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { tryCopyTextToClipboard } from '@/lib/clipboard';
import { formatDiscountRowValue } from '@/lib/discount-row-format';
import { formatDate } from '@/lib/format';
import type { components } from '@/types/generated/admin-api.generated';
import type { DiscountCode, DiscountCodeFilters, DiscountType, ServiceSummary } from '@/types/services';

type ApiSchemas = components['schemas'];

const COLUMN_COUNT = 8;

export interface DiscountCodesPanelProps {
  codes: DiscountCode[];
  filters: DiscountCodeFilters;
  isLoading: boolean;
  isLoadingMore: boolean;
  isSaving: boolean;
  hasMore: boolean;
  error: string;
  /** Services for scope pickers; defaults to [] when omitted (e.g. tests). */
  serviceOptions?: ServiceSummary[];
  /** Full service list for editor/referral labels (e.g. includes archived). Defaults to serviceOptions. */
  serviceDirectoryForDisplay?: ServiceSummary[];
  /** Bumps to clear cached instance options after mutations. */
  instanceOptionsRefreshKey?: unknown;
  onFilterChange: <TKey extends keyof DiscountCodeFilters>(key: TKey, value: DiscountCodeFilters[TKey]) => void;
  onLoadMore: () => Promise<void> | void;
  onCreate: (
    payload: ApiSchemas['CreateDiscountCodeRequest'],
    options?: { batchSaving?: boolean }
  ) => Promise<unknown> | void;
  onUpdate: (codeId: string, payload: ApiSchemas['UpdateDiscountCodeRequest']) => Promise<unknown> | void;
  onDelete: (codeId: string) => Promise<void> | void;
  /** Optional refresh after a failed duplicate-retry batch (intermediate attempts skip refetch). */
  onDiscountCodesRefresh?: () => void | Promise<void>;
}

/**
 * Table-first discount codes: filters and `New code` on top, one expandable
 * row per code with its editor beneath, and Copy, Link/QR, and Delete in the
 * Operations column (Link/QR and Delete collapse into the overflow menu).
 */
export function DiscountCodesPanel({
  codes,
  filters,
  isLoading,
  isLoadingMore,
  isSaving,
  hasMore,
  error,
  serviceOptions = [],
  serviceDirectoryForDisplay,
  instanceOptionsRefreshKey,
  onFilterChange,
  onLoadMore,
  onCreate,
  onUpdate,
  onDelete,
  onDiscountCodesRefresh,
}: DiscountCodesPanelProps) {
  const [referralTarget, setReferralTarget] = useState<{
    code: string;
    serviceKey: string | null;
    discountType: DiscountType;
  } | null>(null);
  const { copiedKey: copiedDiscountCodeId, markCopied: markDiscountCodeCopied } = useCopyFeedback(1000);
  const directoryList = serviceDirectoryForDisplay ?? serviceOptions;

  const serviceById = useMemo(() => {
    const map = new Map<string, ServiceSummary>();
    for (const svc of directoryList) {
      map.set(svc.id, svc);
    }
    return map;
  }, [directoryList]);

  const editor = useDiscountCodeEditor({
    codes,
    isLoading,
    isSaving,
    serviceOptions,
    serviceById,
    instanceOptionsRefreshKey,
    onCreate,
    onUpdate,
    onDelete,
    onDiscountCodesRefresh,
  });
  const { expanded, editorIsBusy, deletingCodeId, handleDeleteCode } = editor;

  async function handleCopyDiscountCode(rowId: string, value: string) {
    const ok = await tryCopyTextToClipboard(value.trim().toUpperCase());
    if (ok) {
      markDiscountCodeCopied(rowId);
    }
  }

  function openReferralDialog(entry: DiscountCode) {
    const slug = entry.serviceId ? (serviceById.get(entry.serviceId)?.serviceKey?.trim() ?? null) : null;
    setReferralTarget({
      code: entry.code,
      discountType: entry.discountType,
      serviceKey: slug && slug.length ? slug : null,
    });
  }

  const detail = <DiscountCodeEditorPanel editor={editor} />;
  const listError = [error, editor.shell.deleteActionError].filter(Boolean).join(' • ');

  return (
    <>
      <ConfirmDialog {...editor.shell.confirmDialogProps} />
      <ConfirmDialog {...editor.scopeConfirmProps} />
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Discount codes'
        columnCount={COLUMN_COUNT}
        rowCount={codes.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        error={listError}
        errorTitle='Discount codes'
        emptyLabel='No discount codes match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New code'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='discount-filter-search' className='sm:basis-64'>
              <Input
                id='discount-filter-search'
                value={filters.search}
                autoComplete='off'
                onChange={(event) => onFilterChange('search', event.target.value)}
                placeholder='Code'
              />
            </AdminFilterField>
            <AdminFilterField label='Status' htmlFor='discount-filter-active'>
              <Select
                id='discount-filter-active'
                value={filters.active}
                onChange={(event) => onFilterChange('active', event.target.value as DiscountCodeFilters['active'])}
              >
                <option value=''>All</option>
                <option value='true'>Enabled</option>
                <option value='false'>Disabled</option>
              </Select>
            </AdminFilterField>
            <AdminFilterField label='Scope' htmlFor='discount-filter-scope' className='sm:basis-44'>
              <Select
                id='discount-filter-scope'
                value={filters.scope}
                onChange={(event) => onFilterChange('scope', event.target.value as DiscountCodeFilters['scope'])}
              >
                <option value=''>All scopes</option>
                <option value='unscoped'>All services</option>
                <option value='service'>Service only</option>
                <option value='instance'>Instance-scoped</option>
              </Select>
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Code</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Valid from</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Valid until</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Value</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Uses</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Status</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new discount code'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New code</AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
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
            detail={detail}
          />
        ) : null}
        {codes.map((row) => {
          const isOpen = expanded.isExpanded(row.id);
          const valueLabel = formatDiscountRowValue(row);
          const usesLabel = `${row.currentUses}/${row.maxUses ?? '∞'}`;
          const statusLabel = row.active ? 'Enabled' : 'Disabled';
          const isCopied = copiedDiscountCodeId === row.id;
          const isDeleting = deletingCodeId === row.id;
          return (
            <AdminExpandableRow
              key={row.id}
              id={row.id}
              label={row.code}
              expanded={isOpen}
              onToggle={() => expanded.toggle(row.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {row.code}
                    <AdminDataTableCellMeta>
                      {valueLabel} · {usesLabel} uses · {statusLabel}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {formatDate(row.validFrom)}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {formatDate(row.validUntil)}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {valueLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {usesLabel}
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
                      key: 'copy',
                      label: isCopied ? 'Discount code copied' : 'Copy discount code',
                      icon: isCopied ? <CheckIcon className='h-4 w-4' /> : <CopyIcon className='h-4 w-4' />,
                      tone: isCopied ? 'success' : 'default',
                      disabled: editorIsBusy,
                      onClick: () => void handleCopyDiscountCode(row.id, row.code),
                    },
                    {
                      key: 'qr',
                      label: 'Link and QR',
                      icon: <QrLinkIcon className='h-4 w-4' />,
                      disabled: editorIsBusy,
                      onClick: () => openReferralDialog(row),
                    },
                    {
                      key: 'delete',
                      label: isDeleting ? 'Deleting discount code' : 'Delete discount code',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: editorIsBusy || isDeleting,
                      onClick: () => void handleDeleteCode(row),
                    },
                  ]}
                />
              }
              detail={isOpen ? detail : null}
            />
          );
        })}
      </AdminRecordTable>
      <ReferralLinkQrDialog
        open={referralTarget !== null}
        discountCode={referralTarget?.code ?? ''}
        serviceKey={referralTarget?.serviceKey ?? null}
        discountType={referralTarget?.discountType ?? 'percentage'}
        onClose={() => setReferralTarget(null)}
      />
    </>
  );
}
