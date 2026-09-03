'use client';

import { useMemo, type ReactNode } from 'react';

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
import {
  formatEnumLabel,
  formatInstanceSlotLocationSummary,
  formatInstanceTableCapacity,
  formatInstanceTableTierCohort,
  formatInstanceTableTitle,
  formatSessionSlotStartsAtDisplay,
  getFirstSessionSlotForDisplay,
  INSTANCE_TABLE_TIER_COHORT_HEADER,
} from '@/lib/format';
import { isInstancesListStatusFilter, type InstancesListStatusFilter } from '@/lib/instance-list-filtering';

import type { LocationSummary, ServiceInstance } from '@/types/services';
import { SERVICE_TYPES } from '@/types/services';

const COLUMN_COUNT = 7;

export interface InstanceServiceFilterOption {
  id: string;
  title: string;
}

export interface InstanceListPanelProps {
  /** Rows after the client-side status/search narrowing, newest first. */
  instances: ServiceInstance[];
  /** Expanded instance hidden by the narrowing; rendered above the rows so its editor stays open. */
  pinnedInstance?: ServiceInstance | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  isMutating: boolean;
  onLoadMore: () => Promise<void> | void;
  /** Single-open expansion state shared with the page (`?instance=`). */
  expanded: UseExpandedRecordReturn;
  /** Editor rendered inside the draft row. */
  draftDetail: ReactNode;
  /** Editor rendered inside an expanded instance row. */
  renderDetail: (instance: ServiceInstance) => ReactNode;
  /** Resolve true when the draft flow started (e.g. instance loaded); omit feedback on failure. */
  onDuplicateInstance: (instance: ServiceInstance) => Promise<boolean> | boolean | void;
  onDeleteInstance: (instanceId: string, serviceId: string) => Promise<void>;
  serviceFilter: {
    value: string;
    options: InstanceServiceFilterOption[];
    onChange: (serviceId: string) => void;
  };
  serviceTypeFilter: {
    value: string;
    onChange: (serviceType: string) => void;
  };
  statusFilter: {
    value: InstancesListStatusFilter;
    onChange: (value: InstancesListStatusFilter) => void;
  };
  searchFilter: {
    value: string;
    onChange: (value: string) => void;
  };
  /** Resolve location ids for the locations column (ids shown when unknown). */
  locationOptions?: LocationSummary[];
}

/**
 * Table-first instances list: filters and `New instance` on top, one
 * expandable row per instance with the editor (and its Enrollments
 * disclosure) beneath it. Duplicate and Delete live in the Operations column.
 */
export function InstanceListPanel({
  instances,
  pinnedInstance = null,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  isMutating,
  onLoadMore,
  expanded,
  draftDetail,
  renderDetail,
  onDuplicateInstance,
  onDeleteInstance,
  serviceFilter,
  serviceTypeFilter,
  statusFilter,
  searchFilter,
  locationOptions = [],
}: InstanceListPanelProps) {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const { copiedKey: duplicateDraftFeedbackId, markCopied: markDuplicateDraftFeedback } = useCopyFeedback(1000);
  const locationById = useMemo(() => new Map(locationOptions.map((loc) => [loc.id, loc])), [locationOptions]);

  const handleDuplicateInstance = async (instance: ServiceInstance) => {
    const started = await onDuplicateInstance(instance);
    if (started === true) {
      markDuplicateDraftFeedback(instance.id);
    }
  };

  const handleDeleteInstance = async (instance: ServiceInstance) => {
    const deleteLabel = formatInstanceTableTitle(instance);
    const confirmed = await requestConfirm({
      title: 'Delete instance',
      description: `Delete "${deleteLabel.trim() !== '' ? deleteLabel : 'this instance'}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await onDeleteInstance(instance.id, instance.serviceId);
  };

  const rows = pinnedInstance ? [pinnedInstance, ...instances] : instances;

  return (
    <>
      <AdminRecordTable
        aria-label='Instances'
        columnCount={COLUMN_COUNT}
        rowCount={rows.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        error={error}
        errorTitle='Instances'
        emptyLabel='No instances match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New instance'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='instances-filter-search' className='sm:basis-[14.4rem]'>
              <Input
                id='instances-filter-search'
                value={searchFilter.value}
                autoComplete='off'
                onChange={(event) => searchFilter.onChange(event.target.value)}
                placeholder='Title, cohort, service, locations'
              />
            </AdminFilterField>
            <AdminFilterField label='Type' htmlFor='instances-filter-service-type' className='sm:basis-40'>
              <Select
                id='instances-filter-service-type'
                value={serviceTypeFilter.value}
                onChange={(event) => serviceTypeFilter.onChange(event.target.value)}
              >
                <option value=''>All types</option>
                {SERVICE_TYPES.map((serviceType) => (
                  <option key={serviceType} value={serviceType}>
                    {formatEnumLabel(serviceType)}
                  </option>
                ))}
              </Select>
            </AdminFilterField>
            <AdminFilterField label='Status' htmlFor='instances-filter-status' className='sm:basis-40'>
              <Select
                id='instances-filter-status'
                value={statusFilter.value}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (isInstancesListStatusFilter(raw)) {
                    statusFilter.onChange(raw);
                  }
                }}
              >
                <option value=''>All statuses</option>
                <option value='not_completed'>Not Completed</option>
                <option value='completed'>Completed</option>
              </Select>
            </AdminFilterField>
            <AdminFilterField label='Service' htmlFor='instances-filter-service' className='sm:basis-56'>
              <Select
                id='instances-filter-service'
                value={serviceFilter.value}
                onChange={(event) => serviceFilter.onChange(event.target.value)}
              >
                <option value=''>All services</option>
                {serviceFilter.options.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
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
            <AdminDataTableHeadCell priority='secondary'>{INSTANCE_TABLE_TIER_COHORT_HEADER}</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Locations</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>First slot</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Capacity</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new instance'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New instance</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
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
              </>
            }
            actions={null}
            detail={draftDetail}
          />
        ) : null}
        {rows.map((instance) => {
          const isOpen = expanded.isExpanded(instance.id);
          const title = formatInstanceTableTitle(instance);
          const tierCohort = formatInstanceTableTierCohort(instance);
          const firstSlot = getFirstSessionSlotForDisplay(instance.sessionSlots);
          const firstSlotLabel = firstSlot ? formatSessionSlotStartsAtDisplay(firstSlot.startsAt) : '—';
          const capacityLabel = formatInstanceTableCapacity(instance);
          const isDuplicateReady = duplicateDraftFeedbackId === instance.id;
          return (
            <AdminExpandableRow
              key={instance.id}
              id={instance.id}
              label={title.trim() !== '' ? title : 'instance'}
              expanded={isOpen}
              onToggle={() => expanded.toggle(instance.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {title.trim() !== '' ? title : '\u00a0'}
                    <AdminDataTableCellMeta>
                      {[tierCohort || null, firstSlotLabel, capacityLabel].filter(Boolean).join(' · ')}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {tierCohort !== '' ? tierCohort : '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {formatInstanceSlotLocationSummary(instance, locationById)}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {firstSlotLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    <span className='inline-flex flex-wrap items-center gap-2'>
                      <span className='tabular-nums'>{capacityLabel}</span>
                      {instance.capacityLeftOverride != null ? (
                        <span
                          className='rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-900'
                          title='Capacity left override is active'
                        >
                          Override
                        </span>
                      ) : null}
                    </span>
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'duplicate',
                      label: isDuplicateReady ? 'Draft copy ready' : 'Duplicate instance as new draft',
                      icon: isDuplicateReady ? (
                        <CheckIcon className='h-4 w-4' />
                      ) : (
                        <DuplicateIcon className='h-4 w-4' />
                      ),
                      tone: isDuplicateReady ? 'success' : 'default',
                      disabled: isMutating,
                      onClick: () => void handleDuplicateInstance(instance),
                    },
                    {
                      key: 'delete',
                      label: 'Delete instance',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isMutating,
                      onClick: () => void handleDeleteInstance(instance),
                    },
                  ]}
                />
              }
              detail={isOpen ? renderDetail(instance) : null}
            />
          );
        })}
      </AdminRecordTable>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
