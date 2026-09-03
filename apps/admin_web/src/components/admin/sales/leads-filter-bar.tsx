'use client';

import type { AdminUser, ContactSource, FunnelStage, LeadListFilters, LeadType } from '@/types/leads';
import { CONTACT_SOURCES, FUNNEL_STAGES, LEAD_TYPES } from '@/types/leads';

import { AdminCreateButton } from '@/components/ui/admin-create-button';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';

import { getStageBadgeClass } from './stage-utils';

export interface LeadsFilterBarProps {
  filters: LeadListFilters;
  users: AdminUser[];
  isCreateMode?: boolean;
  onCreateLead: () => void;
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

export function LeadsFilterBar({
  filters,
  users,
  isCreateMode = false,
  onCreateLead,
  onFilterChange,
}: LeadsFilterBarProps) {
  return (
    <div className='w-full space-y-3'>
      <div>
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
      <AdminFilterBar
        className='mb-0'
        trailing={
          <AdminCreateButton label='New lead' active={isCreateMode} onClick={onCreateLead} />
        }
      >
        <AdminFilterField label='Search' htmlFor='leads-filter-search' className='sm:basis-56'>
          <Input
            id='leads-filter-search'
            value={filters.search}
            onChange={(event) => onFilterChange('search', event.target.value)}
            placeholder='Search by name or email'
          />
        </AdminFilterField>
        <AdminFilterField label='Source' htmlFor='leads-filter-source'>
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
        </AdminFilterField>
        <AdminFilterField label='Lead type' htmlFor='leads-filter-lead-type'>
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
        </AdminFilterField>
        <AdminFilterField label='Assignee' htmlFor='leads-filter-assignee'>
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
        </AdminFilterField>
      </AdminFilterBar>
    </div>
  );
}
