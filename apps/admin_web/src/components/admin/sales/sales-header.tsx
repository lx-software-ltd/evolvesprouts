'use client';

import type { DateRange } from '@/hooks/use-lead-analytics';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatDateForInput } from '@/lib/format';

export interface SalesHeaderProps {
  dateRange: DateRange;
  onDateRangeChange: (nextDateRange: DateRange) => void;
  onRefresh: () => Promise<void> | void;
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

export function SalesHeader({ dateRange, onDateRangeChange, onRefresh }: SalesHeaderProps) {
  const presetValue = dateRange.dateFrom === null && dateRange.dateTo === null ? 'all' : 'custom';

  return (
    <div className='flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:rounded-xl sm:p-5'>
      <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
        <h1 className='text-xl font-semibold text-slate-900'>Sales Analytics</h1>
        <div className='flex flex-wrap gap-2'>
          <Button type='button' variant='ghost' onClick={() => void onRefresh()}>
            Refresh
          </Button>
        </div>
      </div>
      <div className='grid grid-cols-1 gap-2 md:grid-cols-[180px_1fr_1fr]'>
        <Select
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
        <Input
          type='date'
          aria-label='Analytics date from'
          value={dateRange.dateFrom ?? ''}
          onChange={(event) =>
            onDateRangeChange({ ...dateRange, dateFrom: event.target.value || null })
          }
        />
        <Input
          type='date'
          aria-label='Analytics date to'
          value={dateRange.dateTo ?? ''}
          onChange={(event) =>
            onDateRangeChange({ ...dateRange, dateTo: event.target.value || null })
          }
        />
      </div>
    </div>
  );
}
