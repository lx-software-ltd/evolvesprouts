'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { useMemo } from 'react';

import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DeleteIcon, DuplicateIcon } from '@/components/icons/action-icons';
import { CopyFeedbackIconButton } from '@/components/ui/copy-feedback-icon-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { Select } from '@/components/ui/select';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import type { InstancesListStatusFilter } from '@/hooks/use-services-page';
import { useCopyFeedback } from '@/hooks/use-copy-feedback';
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

import type { LocationSummary, ServiceInstance, ServiceType } from '@/types/services';
import { SERVICE_TYPES } from '@/types/services';

export interface InstanceServiceFilterOption {
  id: string;
  title: string;
}

export interface InstanceListPanelProps {
  instances: ServiceInstance[];
  selectedInstanceId: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  isMutating: boolean;
  onSelectInstance: (instanceId: string) => void;
  onLoadMore: () => Promise<void> | void;
  /** Resolve true when the draft flow started (e.g. instance loaded); omit feedback on failure. */
  onDuplicateInstance: (instance: ServiceInstance) => Promise<boolean> | boolean | void;
  onDeleteInstance: (instanceId: string, serviceId: string) => Promise<void>;
  /** When set, show a service filter above the table (empty value = all services). */
  serviceFilter?: {
    value: string;
    options: InstanceServiceFilterOption[];
    onChange: (serviceId: string) => void;
  };
  /** When set, show a service type filter above the table (empty value = all types). */
  serviceTypeFilter?: {
    value: string;
    onChange: (serviceType: string) => void;
  };
  /** When set, show an instance lifecycle status filter above the table. */
  statusFilter?: {
    value: InstancesListStatusFilter;
    onChange: (value: InstancesListStatusFilter) => void;
  };
  searchFilter?: {
    value: string;
    onChange: (value: string) => void;
  };
  /** When true, add cross-service columns (title, tier · cohort, locations, first slot) before capacity. */
  showServiceColumn?: boolean;
  /** Resolve location ids for the locations column (optional; ids shown when unknown). */
  locationOptions?: LocationSummary[];
}

export function InstanceListPanel({
  instances,
  selectedInstanceId,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  isMutating,
  onSelectInstance,
  onLoadMore,
  onDuplicateInstance,
  onDeleteInstance,
  serviceFilter,
  serviceTypeFilter,
  statusFilter,
  searchFilter,
  showServiceColumn = false,
  locationOptions = [],
}: InstanceListPanelProps) {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const { copiedKey: duplicateDraftFeedbackId, markCopied: markDuplicateDraftFeedback } = useCopyFeedback(1000);
  const locationById = useMemo(
    () => new Map(locationOptions.map((loc) => [loc.id, loc])),
    [locationOptions]
  );

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, instanceId: string) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectInstance(instanceId);
    }
  };

  const handleDuplicateInstance = async (instance: ServiceInstance, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const started = await onDuplicateInstance(instance);
    if (started === true) {
      markDuplicateDraftFeedback(instance.id);
    }
  };

  const handleDeleteInstance = async (
    instance: ServiceInstance,
    event: MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
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

  return (
    <>
      <PaginatedTableCard
        title='Instances'
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={error}
        loadingLabel='Loading instances...'
        onLoadMore={onLoadMore}
        toolbar={
          serviceFilter || serviceTypeFilter || statusFilter || searchFilter ? (
            <AdminTableToolbar className='w-full min-w-0 flex-nowrap'>
              {searchFilter ? (
                <div
                  className={
                    serviceTypeFilter || statusFilter || serviceFilter ? 'min-w-0 flex-[2]' : 'min-w-[220px] flex-1'
                  }
                >
                  <Label htmlFor='instances-filter-search'>Search instances</Label>
                  <Input
                    id='instances-filter-search'
                    value={searchFilter.value}
                    onChange={(event) => searchFilter.onChange(event.target.value)}
                    placeholder='Title, cohort, service, locations'
                  />
                </div>
              ) : null}
              {serviceTypeFilter ? (
                <div className='min-w-0 flex-1'>
                  <Label htmlFor='instances-filter-service-type'>Type</Label>
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
                </div>
              ) : null}
              {statusFilter ? (
                <div className='min-w-0 flex-1'>
                  <Label htmlFor='instances-filter-status'>Instance statuses</Label>
                  <Select
                    id='instances-filter-status'
                    value={statusFilter.value}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (raw === '' || raw === 'not_completed' || raw === 'completed') {
                        statusFilter.onChange(raw);
                      }
                    }}
                  >
                    <option value=''>All statuses</option>
                    <option value='not_completed'>Not Completed</option>
                    <option value='completed'>Completed</option>
                  </Select>
                </div>
              ) : null}
              {serviceFilter ? (
                <div className='min-w-0 flex-1'>
                  <Label htmlFor='instances-filter-service'>Service</Label>
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
                </div>
              ) : null}
            </AdminTableToolbar>
          ) : undefined
        }
      >
        <div className='min-w-0'>
          <AdminDataTable tableClassName='w-full table-fixed'>
            <AdminDataTableHead>
              <tr>
                {showServiceColumn ? (
                  <AdminDataTableHeadCell className='w-[22%] min-w-0'>Title</AdminDataTableHeadCell>
                ) : null}
                {showServiceColumn ? (
                  <AdminDataTableHeadCell className='w-[17%] min-w-0'>
                    {INSTANCE_TABLE_TIER_COHORT_HEADER}
                  </AdminDataTableHeadCell>
                ) : null}
                {showServiceColumn ? (
                  <AdminDataTableHeadCell className='w-[17%] min-w-0'>Locations</AdminDataTableHeadCell>
                ) : null}
                {showServiceColumn ? (
                  <AdminDataTableHeadCell className='w-[13%] whitespace-nowrap align-middle'>
                    First slot
                  </AdminDataTableHeadCell>
                ) : null}
                <AdminDataTableHeadCell
                  className={
                    showServiceColumn
                      ? 'w-[18%] whitespace-nowrap'
                      : 'min-w-0 whitespace-nowrap'
                  }
                >
                  Capacity
                </AdminDataTableHeadCell>
                <AdminDataTableOperationsHeadCell className='w-[7rem] whitespace-nowrap' />
              </tr>
            </AdminDataTableHead>
            <AdminDataTableBody>
              {instances.map((instance) => {
                const instanceTableTitle = formatInstanceTableTitle(instance);
                const tierCohortDisplay = formatInstanceTableTierCohort(instance);
                const firstSlot = getFirstSessionSlotForDisplay(instance.sessionSlots);
                return (
                  <tr
                    key={instance.id}
                    className={`cursor-pointer transition ${
                      selectedInstanceId === instance.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => onSelectInstance(instance.id)}
                    onKeyDown={(event) => handleRowKeyDown(event, instance.id)}
                    tabIndex={0}
                    role='row'
                    aria-selected={selectedInstanceId === instance.id}
                  >
                    {showServiceColumn ? (
                      <AdminDataTableCell className='min-w-0 break-words'>
                        <span className='inline-flex flex-wrap items-center gap-2'>
                          <span>
                            {instanceTableTitle.trim() !== '' ? instanceTableTitle : '\u00a0'}
                          </span>
                        </span>
                      </AdminDataTableCell>
                    ) : null}
                    {showServiceColumn ? (
                      <AdminDataTableCell className='min-w-0 break-words text-sm'>
                        {tierCohortDisplay !== '' ? tierCohortDisplay : '-'}
                      </AdminDataTableCell>
                    ) : null}
                    {showServiceColumn ? (
                      <AdminDataTableCell className='min-w-0 break-words text-sm'>
                        {formatInstanceSlotLocationSummary(instance, locationById)}
                      </AdminDataTableCell>
                    ) : null}
                    {showServiceColumn ? (
                      <AdminDataTableCell className='whitespace-nowrap align-middle text-sm'>
                        {firstSlot ? formatSessionSlotStartsAtDisplay(firstSlot.startsAt) : '-'}
                      </AdminDataTableCell>
                    ) : null}
                    <AdminDataTableCell className='whitespace-nowrap'>
                      <span className='inline-flex items-center gap-2'>
                        <span>{formatInstanceTableCapacity(instance)}</span>
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
                    <AdminDataTableCell className='whitespace-nowrap text-right'>
                      <div className='flex justify-end gap-2'>
                        <CopyFeedbackIconButton
                          copied={duplicateDraftFeedbackId === instance.id}
                          idleVariant='outline'
                          idleIcon={<DuplicateIcon className='h-4 w-4' />}
                          disabled={isMutating}
                          onClick={(event) => void handleDuplicateInstance(instance, event)}
                          idleLabel='Duplicate instance as new row'
                          copiedLabel='Draft copy ready'
                          idleTitle='Duplicate instance as new row'
                          copiedTitle='Copied'
                        />
                        <Button
                          type='button'
                          size='sm'
                          variant='danger'
                          onClick={(event) => void handleDeleteInstance(instance, event)}
                          disabled={isMutating}
                          aria-label='Delete instance'
                          title='Delete instance'
                        >
                          <DeleteIcon className='h-4 w-4' />
                        </Button>
                      </div>
                    </AdminDataTableCell>
                  </tr>
                );
              })}
            </AdminDataTableBody>
          </AdminDataTable>
        </div>
      </PaginatedTableCard>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
