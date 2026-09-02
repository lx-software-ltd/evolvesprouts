'use client';

import { Label } from '@/components/ui/label';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';

import type { EntityTagRef } from '@/lib/entity-api';

export interface EntityTagPickerProps {
  id: string;
  label: string;
  tags: EntityTagRef[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** When set, the picker is hidden behind a disclosure (same pattern as structured JSON fields elsewhere in admin). */
  variant?: 'default' | 'collapsible';
}

export function EntityTagPicker({
  id,
  label,
  tags,
  selectedIds,
  onChange,
  disabled,
  variant = 'default',
}: EntityTagPickerProps) {
  const set = new Set(selectedIds);

  function toggle(tagId: string) {
    const next = new Set(set);
    if (next.has(tagId)) {
      next.delete(tagId);
    } else {
      next.add(tagId);
    }
    onChange([...next]);
  }

  if (tags.length === 0) {
    if (variant === 'collapsible') {
      return (
        <AdminDisclosure id={id} title={label} disabled={disabled}>
          <p id={id} className='text-sm text-slate-500'>
            No tags in the database yet.
          </p>
        </AdminDisclosure>
      );
    }
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p id={id} className='text-sm text-slate-500'>
          No tags in the database yet.
        </p>
      </div>
    );
  }

  const list = (
    <div
      className={
        variant === 'collapsible'
          ? 'max-h-40 space-y-2 overflow-y-auto pt-1'
          : 'max-h-40 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3'
      }
    >
      {tags.map((tag) => (
        <label key={tag.id} className='flex cursor-pointer items-center gap-2 text-sm'>
          <input
            type='checkbox'
            className='h-4 w-4 rounded border-slate-300'
            checked={set.has(tag.id)}
            onChange={() => toggle(tag.id)}
          />
          <span>{tag.name}</span>
        </label>
      ))}
    </div>
  );

  if (variant === 'collapsible') {
    return (
      <AdminDisclosure
        id={id}
        title={label}
        summary={selectedIds.length > 0 ? `${selectedIds.length} selected` : undefined}
        disabled={disabled}
      >
        {list}
      </AdminDisclosure>
    );
  }

  return (
    <fieldset disabled={disabled} className='space-y-2'>
      <legend className='text-sm font-medium text-slate-800'>{label}</legend>
      {list}
    </fieldset>
  );
}
