'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatEnumLabel, getCurrencyOptions } from '@/lib/format';

import { EVENT_CATEGORIES } from '@/types/services';
import type { EventCategory } from '@/types/services';

export interface EventFormState {
  eventCategory: EventCategory;
  defaultPrice: string;
  defaultCurrency: string;
}

export interface EventFormFieldsProps {
  value: EventFormState;
  disabled?: boolean;
  onChange: (value: EventFormState) => void;
  /** When true, category is shown read-only (inherited from parent service). */
  categoryReadOnly?: boolean;
  /** Optional id for the category control (read-only input or select). */
  categoryFieldId?: string;
}

export function EventCategoryControl({
  value,
  disabled = false,
  onChange,
  categoryReadOnly = false,
  categoryFieldId = 'event-category',
}: EventFormFieldsProps) {
  if (categoryReadOnly) {
    return (
      <div>
        <Label htmlFor={categoryFieldId}>Event category</Label>
        <Input
          id={categoryFieldId}
          readOnly
          value={formatEnumLabel(value.eventCategory)}
          className='bg-slate-50 text-slate-700'
        />
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor={categoryFieldId}>Event category</Label>
      <Select
        id={categoryFieldId}
        value={value.eventCategory}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, eventCategory: event.target.value as EventCategory })}
      >
        {EVENT_CATEGORIES.map((entry) => (
          <option key={entry} value={entry}>
            {formatEnumLabel(entry)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function EventDefaultPriceControl({
  value,
  disabled = false,
  onChange,
  priceLabel = 'Default price',
}: Pick<EventFormFieldsProps, 'value' | 'disabled' | 'onChange'> & { priceLabel?: string }) {
  return (
    <div>
      <Label htmlFor='event-default-price'>{priceLabel}</Label>
      <Input
        id='event-default-price'
        value={value.defaultPrice}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, defaultPrice: event.target.value })}
        placeholder='0.00'
      />
    </div>
  );
}

export function EventDefaultCurrencyControl({
  value,
  disabled = false,
  onChange,
}: Pick<EventFormFieldsProps, 'value' | 'disabled' | 'onChange'>) {
  const currencyOptions = getCurrencyOptions();
  return (
    <div>
      <Label htmlFor='event-default-currency'>Currency</Label>
      <Select
        id='event-default-currency'
        value={value.defaultCurrency}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, defaultCurrency: event.target.value })}
      >
        {currencyOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
