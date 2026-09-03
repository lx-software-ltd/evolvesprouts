'use client';

import type { ReactNode } from 'react';

import { CheckIcon, DeleteIcon, DuplicateIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useCopyFeedback } from '@/hooks/use-copy-feedback';
import { DRAFT_RECORD_ID, type UseExpandedRecordReturn } from '@/hooks/use-expanded-record';
import { formatEnumLabel, formatServiceListPriceLabel } from '@/lib/format';

import { SERVICE_STATUSES, SERVICE_TYPES } from '@/types/services';
import type { ServiceListFilters, ServiceSummary } from '@/types/services';

const COLUMN_COUNT = 8;

export interface ServiceListPanelProps {
  services: ServiceSummary[];
  /** Expanded service outside the loaded pages (deep link); rendered above the list. */
  pinnedService?: ServiceSummary | null;
  filters: ServiceListFilters;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  isMutating: boolean;
  onFilterChange: <TKey extends keyof ServiceListFilters>(
    key: TKey,
    value: ServiceListFilters[TKey]
  ) => void;
  onLoadMore: () => Promise<void> | void;
  /** Single-open expansion state shared with the page (`?service=`). */
  expanded: UseExpandedRecordReturn;
  /** Editor rendered inside the draft row. */
  draftDetail: ReactNode;
  /** Editor rendered inside an expanded service row. */
  renderDetail: (service: ServiceSummary) => ReactNode;
  /** Resolve true when the draft flow started (e.g. service loaded); omit feedback on failure. */
  onDuplicateService: (serviceId: string) => Promise<boolean> | boolean | void;
  onDeleteService: (serviceId: string) => Promise<void>;
}

/**
 * Table-first service catalogue: filters and `New service` on top, one
 * expandable row per service with the editor beneath it. Duplicate and
 * Delete live in the Operations column.
 */
export function ServiceListPanel({
  services,
  pinnedService = null,
  filters,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  isMutating,
  onFilterChange,
  onLoadMore,
  expanded,
  draftDetail,
  renderDetail,
  onDuplicateService,
  onDeleteService,
}: ServiceListPanelProps) {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const { copiedKey: duplicateDraftFeedbackId, markCopied: markDuplicateDraftFeedback } = useCopyFeedback(1000);

  const handleDuplicateService = async (service: ServiceSummary) => {
    const started = await onDuplicateService(service.id);
    if (started === true) {
      markDuplicateDraftFeedback(service.id);
    }
  };

  const handleDeleteService = async (service: ServiceSummary) => {
    const confirmed = await requestConfirm({
      title: 'Delete service',
      description: `Delete "${service.title}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await onDeleteService(service.id);
  };

  const rows = pinnedService && !services.some((entry) => entry.id === pinnedService.id)
    ? [pinnedService, ...services]
    : services;

  return (
    <>
      <AdminRecordTable
        aria-label='Services'
        columnCount={COLUMN_COUNT}
        rowCount={rows.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        error={error}
        errorTitle='Services'
        emptyLabel='No services match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New service'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='services-filter-search' className='sm:basis-72'>
              <Input
                id='services-filter-search'
                value={filters.search}
                autoComplete='off'
                onChange={(event) => onFilterChange('search', event.target.value)}
                placeholder='Title or description'
              />
            </AdminFilterField>
            <AdminFilterField label='Type' htmlFor='services-filter-type' className='sm:basis-40'>
              <Select
                id='services-filter-type'
                value={filters.serviceType}
                onChange={(event) =>
                  onFilterChange('serviceType', event.target.value as ServiceListFilters['serviceType'])
                }
              >
                <option value=''>All types</option>
                {SERVICE_TYPES.map((entry) => (
                  <option key={entry} value={entry}>
                    {formatEnumLabel(entry)}
                  </option>
                ))}
              </Select>
            </AdminFilterField>
            <AdminFilterField label='Status' htmlFor='services-filter-status' className='sm:basis-40'>
              <Select
                id='services-filter-status'
                value={filters.status}
                onChange={(event) => onFilterChange('status', event.target.value as ServiceListFilters['status'])}
              >
                <option value=''>All statuses</option>
                {SERVICE_STATUSES.map((entry) => (
                  <option key={entry} value={entry}>
                    {formatEnumLabel(entry)}
                  </option>
                ))}
              </Select>
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Title</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Tier</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Type</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Price</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Status</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Delivery</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new service'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New service</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
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
            detail={draftDetail}
          />
        ) : null}
        {rows.map((service) => {
          const isOpen = expanded.isExpanded(service.id);
          const tierLabel = service.serviceTier?.trim() ? service.serviceTier : '—';
          const typeLabel = formatEnumLabel(service.serviceType);
          const statusLabel = formatEnumLabel(service.status);
          const isDuplicateReady = duplicateDraftFeedbackId === service.id;
          const hasInstances = service.instancesCount > 0;
          return (
            <AdminExpandableRow
              key={service.id}
              id={service.id}
              label={service.title}
              expanded={isOpen}
              onToggle={() => expanded.toggle(service.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {service.title}
                    <AdminDataTableCellMeta>
                      {typeLabel} · {statusLabel}
                      {service.serviceTier?.trim() ? ` · ${service.serviceTier}` : ''}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {tierLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {typeLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {formatServiceListPriceLabel(service)}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {statusLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {formatEnumLabel(service.deliveryMode)}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'duplicate',
                      label: isDuplicateReady ? 'Draft copy ready' : 'Duplicate service as new draft',
                      icon: isDuplicateReady ? (
                        <CheckIcon className='h-4 w-4' />
                      ) : (
                        <DuplicateIcon className='h-4 w-4' />
                      ),
                      tone: isDuplicateReady ? 'success' : 'default',
                      disabled: isMutating,
                      onClick: () => void handleDuplicateService(service),
                    },
                    {
                      key: 'delete',
                      label: hasInstances ? 'Cannot delete service while it has instances' : 'Delete service',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isMutating || hasInstances,
                      onClick: () => void handleDeleteService(service),
                    },
                  ]}
                />
              }
              detail={isOpen ? renderDetail(service) : null}
            />
          );
        })}
      </AdminRecordTable>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
