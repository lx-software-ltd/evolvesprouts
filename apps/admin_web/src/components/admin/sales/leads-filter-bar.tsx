'use client';

import type { AdminUser, ContactSource, FunnelStage, LeadListFilters, LeadType } from '@/types/leads';
import { CONTACT_SOURCES, FUNNEL_STAGES, LEAD_TYPES } from '@/types/leads';

import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

const STAGE_CHIP_BASE_CLASS =
  'inline-flex h-8 items-center justify-center rounded-full px-3 py-0 text-xs font-semibold leading-none';

function StageFilterChip({
  label,
  colorClass,
  isActive,
  onClick,
}: {
  label: string;
  colorClass: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      aria-pressed={isActive}
      className={`${STAGE_CHIP_BASE_CLASS} ${colorClass} ${isActive ? 'ring-2 ring-slate-400' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function LeadsFilterBar({ filters, users, onFilterChange }: LeadsFilterBarProps) {
  return (
    <AdminTableToolbar marginBottom='none'>
      <div className='w-full'>
        <Label>Stage</Label>
        <div className='flex flex-wrap items-center gap-2' role='group' aria-label='Filter by stage'>
          <StageFilterChip
            label='All'
            colorClass='border border-slate-300 bg-white text-slate-700'
            isActive={filters.stage.length === 0}
            onClick={() => onFilterChange('stage', [])}
          />
          {FUNNEL_STAGES.map((stage: FunnelStage) => (
            <StageFilterChip
              key={stage}
              label={formatEnumLabel(stage)}
              colorClass={getStageBadgeClass(stage)}
              isActive={filters.stage.includes(stage)}
              onClick={() => onFilterChange('stage', toggleArrayValue(filters.stage, stage))}
            />
          ))}
        </div>
      </div>
      <div className='min-w-[200px] flex-1'>
        <Label htmlFor='leads-filter-search'>Search</Label>
        <Input
          id='leads-filter-search'
          value={filters.search}
          onChange={(event) => onFilterChange('search', event.target.value)}
          placeholder='Search by name or email'
        />
      </div>
      <div className='min-w-[150px]'>
        <Label htmlFor='leads-filter-source'>Source</Label>
        <Select
          id='leads-filter-source'
          value={filters.source[0] ?? ''}
          onChange={(event) =>
            onFilterChange('source', event.target.value ? [event.target.value as ContactSource] : [])
          }
        >
          <option value=''>All sources</option>
          {CONTACT_SOURCES.map((source) => (
            <option key={source} value={source}>
              {formatEnumLabel(source)}
            </option>
          ))}
        </Select>
      </div>
      <div className='min-w-[150px]'>
        <Label htmlFor='leads-filter-lead-type'>Lead type</Label>
        <Select
          id='leads-filter-lead-type'
          value={filters.leadType[0] ?? ''}
          onChange={(event) =>
            onFilterChange('leadType', event.target.value ? [event.target.value as LeadType] : [])
          }
        >
          <option value=''>All lead types</option>
          {LEAD_TYPES.map((leadType) => (
            <option key={leadType} value={leadType}>
              {formatEnumLabel(leadType)}
            </option>
          ))}
        </Select>
      </div>
      <div className='min-w-[160px]'>
        <Label htmlFor='leads-filter-assignee'>Assignee</Label>
        <Select
          id='leads-filter-assignee'
          value={filters.assignedTo ?? ''}
          onChange={(event) => onFilterChange('assignedTo', event.target.value || null)}
        >
          <option value=''>All assignees</option>
          {users.map((user) => (
            <option key={user.sub} value={user.sub}>
              {user.name || user.email || user.sub}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor='leads-filter-date-from'>From</Label>
        <Input
          id='leads-filter-date-from'
          type='date'
          value={filters.dateFrom ?? ''}
          onChange={(event) => onFilterChange('dateFrom', event.target.value || null)}
        />
      </div>
      <div>
        <Label htmlFor='leads-filter-date-to'>To</Label>
        <Input
          id='leads-filter-date-to'
          type='date'
          value={filters.dateTo ?? ''}
          onChange={(event) => onFilterChange('dateTo', event.target.value || null)}
        />
      </div>
      <label className='inline-flex h-10 items-center gap-2 text-sm text-slate-700'>
        <input
          type='checkbox'
          checked={filters.unassigned}
          onChange={(event) => onFilterChange('unassigned', event.target.checked)}
        />
        Unassigned only
      </label>
    </AdminTableToolbar>
  );
}
