'use client';

import { DeleteIcon } from '@/components/icons/action-icons';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminIconButton } from '@/components/ui/admin-icon-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatInstanceLocationOptionLabel } from '@/lib/instance-location-options';
import { addHoursToDatetimeLocal } from '@/lib/session-slot-datetime';

import type { LocationSummary, SessionSlotFormRow } from '@/types/services';

export interface SessionSlotEditorProps {
  slots: SessionSlotFormRow[];
  disabled?: boolean;
  locationOptions?: LocationSummary[];
  isLoadingLocations?: boolean;
  /** Instance (or inherited service) venue id used to prefill slot locations. */
  defaultLocationId?: string | null;
  onChange: (slots: SessionSlotFormRow[]) => void;
}

function emptySlot(sortOrder: number, defaultLocationId?: string | null): SessionSlotFormRow {
  const locationId = defaultLocationId?.trim() || null;
  return {
    id: null,
    instanceId: null,
    locationId,
    startsAtLocal: null,
    endsAtLocal: null,
    sortOrder,
  };
}

export function SessionSlotEditor({
  slots,
  disabled = false,
  locationOptions = [],
  isLoadingLocations = false,
  defaultLocationId = null,
  onChange,
}: SessionSlotEditorProps) {
  const hasLocationOptions = locationOptions.length > 0;
  const trimmedDefaultLocation = defaultLocationId?.trim() || null;

  const slotGridClassName =
    'grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-[1fr_1fr_1fr_minmax(0,5.5rem)_auto] sm:items-end';

  return (
    <AdminDisclosure
      id='service-instance-session-slots'
      title='Session slots'
      summary={slots.length > 0 ? slots.length : undefined}
      disabled={disabled}
    >
      <div className='grid grid-rows-[auto_1fr_auto] gap-3'>
        <div className='min-h-0'>
          {slots.length === 0 ? <p className='text-sm text-slate-500'>No slots configured.</p> : null}
        </div>
        <div className='flex min-h-0 flex-col gap-3 overflow-y-auto'>
          {slots.map((slot, index) => (
            <div key={`${slot.id ?? 'new'}-${index}`} className={slotGridClassName}>
              <div className='space-y-1'>
                {index === 0 ? (
                  <Label className='text-xs font-medium text-slate-600' htmlFor={`slot-${index}-starts`}>
                    Start time
                  </Label>
                ) : null}
                <Input
                  id={`slot-${index}-starts`}
                  type='datetime-local'
                  disabled={disabled}
                  aria-label='Start time'
                  value={(slot.startsAtLocal ?? '').slice(0, 16)}
                  onChange={(event) => {
                    const next = [...slots];
                    const startsAtLocal = event.target.value || null;
                    const startComplete = Boolean(startsAtLocal && startsAtLocal.length === 16);
                    let { endsAtLocal } = slot;
                    if (!startsAtLocal) {
                      endsAtLocal = null;
                    } else if (startComplete) {
                      const computedEnd = addHoursToDatetimeLocal(startsAtLocal, 2);
                      endsAtLocal = computedEnd ?? endsAtLocal;
                    }
                    let { locationId } = slot;
                    if (startComplete && trimmedDefaultLocation && !locationId?.trim()) {
                      locationId = trimmedDefaultLocation;
                    }
                    next[index] = { ...slot, startsAtLocal, endsAtLocal, locationId };
                    onChange(next);
                  }}
                />
              </div>
              <div className='space-y-1'>
                {index === 0 ? (
                  <Label className='text-xs font-medium text-slate-600' htmlFor={`slot-${index}-ends`}>
                    End time
                  </Label>
                ) : null}
                <Input
                  id={`slot-${index}-ends`}
                  type='datetime-local'
                  disabled={disabled}
                  aria-label='End time'
                  value={(slot.endsAtLocal ?? '').slice(0, 16)}
                  onChange={(event) => {
                    const next = [...slots];
                    next[index] = { ...slot, endsAtLocal: event.target.value || null };
                    onChange(next);
                  }}
                />
              </div>
              <div className='space-y-1'>
                {index === 0 ? (
                  <Label className='text-xs font-medium text-slate-600' htmlFor={`slot-${index}-location`}>
                    Location
                  </Label>
                ) : null}
                {hasLocationOptions || isLoadingLocations ? (
                  <Select
                    id={`slot-${index}-location`}
                    disabled={disabled}
                    aria-label='Location'
                    value={slot.locationId ?? ''}
                    onChange={(event) => {
                      const next = [...slots];
                      next[index] = { ...slot, locationId: event.target.value || null };
                      onChange(next);
                    }}
                  >
                    <option value=''>
                      {isLoadingLocations ? 'Loading locations...' : 'None'}
                    </option>
                    {slot.locationId &&
                    !locationOptions.some((loc) => loc.id === slot.locationId) ? (
                      <option value={slot.locationId}>{slot.locationId}</option>
                    ) : null}
                    {locationOptions.map((location) => (
                      <option key={location.id} value={location.id}>
                        {formatInstanceLocationOptionLabel(location)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={`slot-${index}-location`}
                    disabled={disabled}
                    aria-label='Location'
                    value={slot.locationId ?? ''}
                    onChange={(event) => {
                      const next = [...slots];
                      next[index] = { ...slot, locationId: event.target.value || null };
                      onChange(next);
                    }}
                    placeholder='Location UUID'
                  />
                )}
              </div>
              <div className='space-y-1'>
                {index === 0 ? (
                  <Label className='text-xs font-medium text-slate-600' htmlFor={`slot-${index}-sort`}>
                    Sort order
                  </Label>
                ) : null}
                <Input
                  id={`slot-${index}-sort`}
                  type='number'
                  disabled={disabled}
                  aria-label='Sort order'
                  value={slot.sortOrder ?? index}
                  onChange={(event) => {
                    const next = [...slots];
                    next[index] = { ...slot, sortOrder: Number(event.target.value) };
                    onChange(next);
                  }}
                />
              </div>
              <div className='flex justify-end pb-0.5 sm:justify-start'>
                <AdminIconButton
                  label='Delete session slot'
                  icon={<DeleteIcon className='h-4 w-4' />}
                  tone='danger'
                  disabled={disabled}
                  onClick={() => onChange(slots.filter((_, itemIndex) => itemIndex !== index))}
                />
              </div>
            </div>
          ))}
        </div>
        <div className='flex justify-start justify-self-start'>
          <Button
            type='button'
            variant='secondary'
            size='sm'
            disabled={disabled}
            onClick={() => onChange([...slots, emptySlot(slots.length, trimmedDefaultLocation)])}
          >
            Add slot
          </Button>
        </div>
      </div>
    </AdminDisclosure>
  );
}
