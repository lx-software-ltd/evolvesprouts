'use client';

import { useMemo } from 'react';

import { AuditLogDetail } from '@/components/admin/audit/audit-log-detail';
import { ActionBadge } from '@/components/admin/audit/audit-log-badges';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuditLogsList, type AuditActionFilter } from '@/hooks/use-audit-logs-list';
import { useExpandedRecord } from '@/hooks/use-expanded-record';
import { formatDate } from '@/lib/format';

export interface AuditLogsPanelProps {
  auditableTables: readonly string[];
}

export const ADMIN_AUDIT_LOG_QUERY_PARAM = 'log';

// Read-only rows: expand column + four data columns, no Operations column.
const COLUMN_COUNT = 5;

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
  const expanded = useExpandedRecord({ paramName: ADMIN_AUDIT_LOG_QUERY_PARAM });
  const timestampHeader = useMemo(() => `Timestamp (${formatGmtOffset()})`, []);

  return (
    <AdminRecordTable
      aria-label='Audit logs'
      columnCount={COLUMN_COUNT}
      rowCount={list.items.length}
      isLoading={list.isLoading && list.items.length === 0}
      isLoadingMore={list.isLoadingMore}
      hasMore={list.hasMore}
      onLoadMore={() => void list.loadMore()}
      error={list.error}
      errorTitle='Audit logs'
      emptyLabel='No audit logs match the current filters.'
      filters={
        <AdminFilterBar
          trailing={
            <>
              <Button type='button' variant='primary' onClick={list.applyFilters} disabled={list.filtersInvalid}>
                Apply filters
              </Button>
              <Button type='button' variant='secondary' onClick={list.clearFilters}>
                Clear
              </Button>
            </>
          }
          summary={
            list.filtersInvalid ? (
              <AdminInlineError size='xs'>Select a table before filtering by record ID.</AdminInlineError>
            ) : null
          }
        >
          <AdminFilterField label='Action' htmlFor='audit-action-filter' className='sm:basis-40'>
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
          </AdminFilterField>
          <AdminFilterField label='Table' htmlFor='audit-table-filter'>
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
          </AdminFilterField>
          <AdminFilterField label='Time range' htmlFor='audit-time-range' className='sm:basis-40'>
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
          </AdminFilterField>
          <AdminFilterField label='Actor' htmlFor='audit-user-email-filter' className='sm:basis-56'>
            <Input
              id='audit-user-email-filter'
              type='text'
              autoComplete='off'
              placeholder='Email, API key, or webhook…'
              value={list.draft.email}
              onChange={(e) => list.setDraftField('email', e.target.value)}
            />
          </AdminFilterField>
          <AdminFilterField label='Record ID' htmlFor='audit-record-filter' className='sm:basis-64'>
            <Input
              id='audit-record-filter'
              type='text'
              autoComplete='off'
              placeholder='Filter by record ID…'
              value={list.draft.recordId}
              onChange={(e) => list.setDraftField('recordId', e.target.value)}
            />
          </AdminFilterField>
        </AdminFilterBar>
      }
      head={
        <tr>
          <AdminDataTableHeadCell className='w-10' />
          <AdminDataTableHeadCell>{timestampHeader}</AdminDataTableHeadCell>
          <AdminDataTableHeadCell>Table / action</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary'>Changed fields</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Actor</AdminDataTableHeadCell>
        </tr>
      }
    >
      {list.items.map((item) => {
        const isOpen = expanded.isExpanded(item.id);
        const actor = item.user_email || item.user_id || '—';
        return (
          <AdminExpandableRow
            key={item.id}
            id={item.id}
            label={`${item.table_name} ${item.action} at ${formatDate(item.timestamp)}`}
            expanded={isOpen}
            onToggle={() => expanded.toggle(item.id)}
            columnCount={COLUMN_COUNT}
            autoFocusDetail={false}
            cells={
              <>
                <AdminDataTableCell className='text-slate-600'>
                  {formatDate(item.timestamp)}
                  <AdminDataTableCellMeta className='font-mono'>{actor}</AdminDataTableCellMeta>
                </AdminDataTableCell>
                <AdminDataTableCell>
                  <div className='space-y-1'>
                    <div className='font-medium text-slate-900'>{item.table_name}</div>
                    <ActionBadge action={item.action} />
                  </div>
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-500'>
                  {item.changed_fields?.length ? item.changed_fields.join(', ') : '—'}
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='font-mono text-xs text-slate-700'>
                  {actor}
                </AdminDataTableCell>
              </>
            }
            detail={isOpen ? <AuditLogDetail log={item} /> : null}
          />
        );
      })}
    </AdminRecordTable>
  );
}
