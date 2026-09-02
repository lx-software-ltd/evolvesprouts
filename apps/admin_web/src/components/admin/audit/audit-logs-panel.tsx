'use client';

import { useMemo, useState } from 'react';

import { AuditLogDetailDialog } from '@/components/admin/audit/audit-log-detail-dialog';
import { ActionBadge } from '@/components/admin/audit/audit-log-badges';
import { ViewIcon } from '@/components/icons/action-icons';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { Select } from '@/components/ui/select';
import { useAuditLogsList, type AuditActionFilter } from '@/hooks/use-audit-logs-list';
import { formatDate } from '@/lib/format';

import type { components } from '@/types/generated/admin-api.generated';

type AuditLog = components['schemas']['AuditLog'];

export interface AuditLogsPanelProps {
  auditableTables: readonly string[];
}

const TIME_RANGES = [
  { value: '', label: 'All time' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;

function formatGmtOffset(date: Date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const minuteSuffix = minutes ? `:${minutes.toString().padStart(2, '0')}` : '';
  return `GMT${sign}${hours}${minuteSuffix}`;
}

export function AuditLogsPanel({ auditableTables }: AuditLogsPanelProps) {
  const list = useAuditLogsList();
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const timestampHeader = useMemo(() => `Timestamp (${formatGmtOffset()})`, []);

  return (
    <div className='space-y-6'>
      <PaginatedTableCard
        title='Audit logs'
        description='Database change history for application tables. API-key writes show the key name as the actor. Webhook and other system writes show a generic actor label.'
        isLoading={list.isLoading && list.items.length === 0}
        isLoadingMore={list.isLoadingMore}
        hasMore={list.hasMore}
        error={list.error}
        loadingLabel='Loading audit logs...'
        onLoadMore={() => void list.loadMore()}
        toolbar={
          <AdminTableToolbar className='mb-6 w-full flex-col items-stretch rounded-lg border border-slate-200 bg-slate-50 p-4'>
            {list.filtersInvalid ? (
              <p className='mb-2 text-sm text-amber-800' role='alert'>
                Select a table before filtering by record ID.
              </p>
            ) : null}
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <div>
                <Label htmlFor='audit-action-filter'>Action</Label>
                <Select
                  id='audit-action-filter'
                  value={list.draft.action}
                  onChange={(e) => list.setDraftField('action', e.target.value as AuditActionFilter)}
                >
                  <option value='all'>All actions</option>
                  <option value='INSERT'>Insert</option>
                  <option value='UPDATE'>Update</option>
                  <option value='DELETE'>Delete</option>
                </Select>
              </div>
              <div>
                <Label htmlFor='audit-table-filter'>Table</Label>
                <Select
                  id='audit-table-filter'
                  value={list.draft.table}
                  onChange={(e) => list.setDraftField('table', e.target.value)}
                >
                  <option value='all'>All tables</option>
                  {auditableTables.map((table) => (
                    <option key={table} value={table}>
                      {table}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor='audit-time-range'>Time range</Label>
                <Select
                  id='audit-time-range'
                  value={list.draft.timeRange}
                  onChange={(e) => list.setDraftField('timeRange', e.target.value)}
                >
                  {TIME_RANGES.map((range) => (
                    <option key={range.value || 'all'} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor='audit-user-email-filter'>Actor</Label>
                <Input
                  id='audit-user-email-filter'
                  type='text'
                  autoComplete='off'
                  placeholder='Email, API key, or webhook…'
                  value={list.draft.email}
                  onChange={(e) => list.setDraftField('email', e.target.value)}
                />
              </div>
            </div>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <div className='lg:col-span-2'>
                <Label htmlFor='audit-record-filter'>Record ID</Label>
                <Input
                  id='audit-record-filter'
                  type='text'
                  autoComplete='off'
                  placeholder='Filter by record ID…'
                  value={list.draft.recordId}
                  onChange={(e) => list.setDraftField('recordId', e.target.value)}
                />
              </div>
              <div className='flex items-end gap-2 lg:col-span-2'>
                <Button
                  type='button'
                  variant='primary'
                  onClick={list.applyFilters}
                  disabled={list.filtersInvalid}
                  className='flex-1 sm:flex-initial'
                >
                  Apply filters
                </Button>
                <Button
                  type='button'
                  variant='secondary'
                  onClick={list.clearFilters}
                  className='flex-1 sm:flex-initial'
                >
                  Clear
                </Button>
              </div>
            </div>
          </AdminTableToolbar>
        }
      >
        {list.items.length === 0 && !list.isLoading ? (
          <p className='text-sm text-slate-600'>No audit logs match the current filters.</p>
        ) : (
          <AdminDataTable>
            <AdminDataTableHead>
              <tr>
                <AdminDataTableHeadCell scope='col'>{timestampHeader}</AdminDataTableHeadCell>
                <AdminDataTableHeadCell scope='col'>Table / action</AdminDataTableHeadCell>
                <AdminDataTableHeadCell scope='col' className='hidden md:table-cell'>
                  Changed fields
                </AdminDataTableHeadCell>
                <AdminDataTableHeadCell scope='col'>Actor</AdminDataTableHeadCell>
                <AdminDataTableOperationsHeadCell scope='col' />
              </tr>
            </AdminDataTableHead>
            <AdminDataTableBody>
              {list.items.map((item) => (
                <tr key={item.id} className='hover:bg-slate-50'>
                  <AdminDataTableCell className='text-slate-600'>{formatDate(item.timestamp)}</AdminDataTableCell>
                  <AdminDataTableCell>
                    <div className='space-y-1'>
                      <div className='font-medium text-slate-900'>{item.table_name}</div>
                      <ActionBadge action={item.action} />
                    </div>
                  </AdminDataTableCell>
                  <AdminDataTableCell className='hidden text-slate-500 md:table-cell'>
                    {item.changed_fields?.length ? item.changed_fields.join(', ') : '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='font-mono text-xs text-slate-700'>
                    {item.user_email || item.user_id || '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='text-right'>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      onClick={() => setSelectedLog(item)}
                      aria-label='View details'
                    >
                      <ViewIcon className='h-4 w-4' />
                    </Button>
                  </AdminDataTableCell>
                </tr>
              ))}
            </AdminDataTableBody>
          </AdminDataTable>
        )}
      </PaginatedTableCard>

      {selectedLog ? (
        <AuditLogDetailDialog log={selectedLog} onClose={() => setSelectedLog(null)} />
      ) : null}
    </div>
  );
}
