'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatEnumLabel, getCurrencyOptions } from '@/lib/format';

import { TRAINING_PRICING_UNITS } from '@/types/services';
import type { TrainingPricingUnit } from '@/types/services';

export interface TrainingFormState {
  pricingUnit: TrainingPricingUnit;
  defaultPrice: string;
  defaultCurrency: string;
}

export interface TrainingFormFieldsProps {
  value: TrainingFormState;
  disabled?: boolean;
  onChange: (value: TrainingFormState) => void;
}

export function TrainingPricingUnitControl({
  value,
  disabled = false,
  onChange,
}: Pick<TrainingFormFieldsProps, 'value' | 'disabled' | 'onChange'>) {
  return (
    <div>
      <Label htmlFor='training-pricing-unit'>Pricing unit</Label>
      <Select
        id='training-pricing-unit'
        value={value.pricingUnit}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...value, pricingUnit: event.target.value as TrainingPricingUnit })
        }
      >
        {TRAINING_PRICING_UNITS.map((entry) => (
          <option key={entry} value={entry}>
            {formatEnumLabel(entry)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function TrainingPriceControl({
  value,
  disabled = false,
  onChange,
  priceLabel = 'Price',
}: Pick<TrainingFormFieldsProps, 'value' | 'disabled' | 'onChange'> & { priceLabel?: string }) {
  return (
    <div>
      <Label htmlFor='training-default-price'>{priceLabel}</Label>
      <Input
        id='training-default-price'
        value={value.defaultPrice}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, defaultPrice: event.target.value })}
        placeholder='0.00'
      />
    </div>
  );
}

export function TrainingCurrencyControl({
  value,
  disabled = false,
  onChange,
}: Pick<TrainingFormFieldsProps, 'value' | 'disabled' | 'onChange'>) {
  const currencyOptions = getCurrencyOptions();
  return (
    <div>
      <Label htmlFor='training-default-currency'>Currency</Label>
      <Select
        id='training-default-currency'
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
