'use client';

import type { AdminUser, ContactSource, FunnelStage, LeadListFilters, LeadType } from '@/types/leads';
import { CONTACT_SOURCES, FUNNEL_STAGES, LEAD_TYPES } from '@/types/leads';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';

import { getStageBadgeClass } from './stage-utils';

export interface LeadsFilterBarProps {
  filters: LeadListFilters;
  users: AdminUser[];
  onFilterChange: <TKey extends keyof LeadListFilters>(
    key: TKey,
    value: LeadListFilters[TKey]
  ) => void;
}

function toggleArrayValue<TValue>(current: TValue[], value: TValue): TValue[] {
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
}

export function LeadsFilterBar({
  filters,
  users,
  onFilterChange,
}: LeadsFilterBarProps) {
  return (
    <div className='space-y-3 rounded-md border border-slate-200 bg-white p-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          type='button'
          variant={filters.stage.length === 0 ? 'secondary' : 'outline'}
          size='sm'
          onClick={() => onFilterChange('stage', [])}
        >
          All
        </Button>
        {FUNNEL_STAGES.map((stage) => {
          const isActive = filters.stage.includes(stage);
          return (
            <button
              key={stage}
              type='button'
              className={`inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-semibold leading-none ${getStageBadgeClass(stage)} ${
                isActive ? 'ring-2 ring-slate-400' : ''
              }`}
              onClick={() => onFilterChange('stage', toggleArrayValue(filters.stage, stage))}
            >
              {formatEnumLabel(stage)}
            </button>
          );
        })}
      </div>
      <div className='grid grid-cols-1 gap-2 md:grid-cols-5'>
        <Select
          value={filters.source[0] ?? ''}
          onChange={(event) =>
            onFilterChange('source', event.target.value ? [event.target.value as ContactSource] : [])
          }
          aria-label='Filter by source'
        >
          <option value=''>All sources</option>
          {CONTACT_SOURCES.map((source) => (
            <option key={source} value={source}>
              {formatEnumLabel(source)}
            </option>
          ))}
        </Select>
        <Select
          value={filters.leadType[0] ?? ''}
          onChange={(event) =>
            onFilterChange('leadType', event.target.value ? [event.target.value as LeadType] : [])
          }
          aria-label='Filter by lead type'
        >
          <option value=''>All lead types</option>
          {LEAD_TYPES.map((leadType) => (
            <option key={leadType} value={leadType}>
              {formatEnumLabel(leadType)}
            </option>
          ))}
        </Select>
        <Select
          value={filters.assignedTo ?? ''}
          onChange={(event) => onFilterChange('assignedTo', event.target.value || null)}
          aria-label='Filter by assignee'
        >
          <option value=''>All assignees</option>
          {users.map((user) => (
            <option key={user.sub} value={user.sub}>
              {user.name || user.email || user.sub}
            </option>
          ))}
        </Select>
        <Input
          type='date'
          value={filters.dateFrom ?? ''}
          onChange={(event) => onFilterChange('dateFrom', event.target.value || null)}
          aria-label='Filter date from'
        />
        <Input
          type='date'
          value={filters.dateTo ?? ''}
          onChange={(event) => onFilterChange('dateTo', event.target.value || null)}
          aria-label='Filter date to'
        />
      </div>
      <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
        <Input
          value={filters.search}
          onChange={(event) => onFilterChange('search', event.target.value)}
          placeholder='Search by name or email'
          aria-label='Search leads'
        />
        <label className='inline-flex items-center gap-2 text-sm text-slate-700'>
          <input
            type='checkbox'
            checked={filters.unassigned}
            onChange={(event) => onFilterChange('unassigned', event.target.checked)}
          />
          Unassigned only
        </label>
      </div>
    </div>
  );
}
