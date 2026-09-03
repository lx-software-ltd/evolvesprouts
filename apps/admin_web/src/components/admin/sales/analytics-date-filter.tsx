'use client';

import type { DateRange } from '@/hooks/use-lead-analytics';

import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatDateForInput } from '@/lib/format';

export interface AnalyticsDateFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (nextDateRange: DateRange) => void;
}

function buildPresetDateRange(value: string): DateRange {
  const now = new Date();
  if (value === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    return { dateFrom: formatDateForInput(weekStart), dateTo: formatDateForInput(now) };
  }
  if (value === 'month') {
    return {
      dateFrom: formatDateForInput(new Date(now.getFullYear(), now.getMonth(), 1)),
      dateTo: formatDateForInput(now),
    };
  }
  if (value === 'quarter') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return {
      dateFrom: formatDateForInput(new Date(now.getFullYear(), quarterStartMonth, 1)),
      dateTo: formatDateForInput(now),
    };
  }
  if (value === 'year') {
    return {
      dateFrom: formatDateForInput(new Date(now.getFullYear(), 0, 1)),
      dateTo: formatDateForInput(now),
    };
  }
  return { dateFrom: null, dateTo: null };
}

/**
 * Date range filters for the Analytics view: an untitled card with the same
 * filter bar as record tables (no heading, no manual refresh; the analytics
 * query re-runs as soon as the range changes).
 */
export function AnalyticsDateFilter({ dateRange, onDateRangeChange }: AnalyticsDateFilterProps) {
  const presetValue = dateRange.dateFrom === null && dateRange.dateTo === null ? 'all' : 'custom';

  return (
    <Card aria-label='Analytics filters'>
      <AdminFilterBar className='mb-0'>
        <AdminFilterField label='Range' htmlFor='analytics-date-preset' className='sm:basis-44'>
          <Select
            id='analytics-date-preset'
            aria-label='Date range preset'
            value={presetValue}
            onChange={(event) => onDateRangeChange(buildPresetDateRange(event.target.value))}
          >
            <option value='all'>All time</option>
            <option value='custom' disabled>
              Custom range
            </option>
            <option value='week'>This week</option>
            <option value='month'>This month</option>
            <option value='quarter'>This quarter</option>
            <option value='year'>This year</option>
          </Select>
        </AdminFilterField>
        <AdminFilterField label='From' htmlFor='analytics-date-from' className='sm:basis-40'>
          <Input
            id='analytics-date-from'
            type='date'
            aria-label='Analytics date from'
            value={dateRange.dateFrom ?? ''}
            onChange={(event) => onDateRangeChange({ ...dateRange, dateFrom: event.target.value || null })}
          />
        </AdminFilterField>
        <AdminFilterField label='To' htmlFor='analytics-date-to' className='sm:basis-40'>
          <Input
            id='analytics-date-to'
            type='date'
            aria-label='Analytics date to'
            value={dateRange.dateTo ?? ''}
            onChange={(event) => onDateRangeChange({ ...dateRange, dateTo: event.target.value || null })}
          />
        </AdminFilterField>
      </AdminFilterBar>
    </Card>
  );
}
