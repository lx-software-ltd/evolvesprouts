'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatEnumLabel, getCurrencyOptions } from '@/lib/format';

import { CONSULTATION_FORMATS, CONSULTATION_PRICING_MODELS } from '@/types/services';
import type { ConsultationFormat, ConsultationPricingModel } from '@/types/services';

export interface ConsultationFormState {
  consultationFormat: ConsultationFormat;
  maxGroupSize: string;
  durationMinutes: string;
  pricingModel: ConsultationPricingModel;
  defaultHourlyRate: string;
  defaultPackagePrice: string;
  defaultPackageSessions: string;
  defaultCurrency: string;
}

export interface ConsultationServicePanelFieldsProps {
  value: ConsultationFormState;
  disabled?: boolean;
  onChange: (value: ConsultationFormState) => void;
}

/** Row C type anchor: consultation format only. */
export function ConsultationServiceFormatField({
  value,
  disabled = false,
  onChange,
}: ConsultationServicePanelFieldsProps) {
  return (
    <div>
      <Label htmlFor='consultation-format'>Consultation format</Label>
      <Select
        id='consultation-format'
        value={value.consultationFormat}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...value, consultationFormat: event.target.value as ConsultationFormat })
        }
      >
        {CONSULTATION_FORMATS.map((entry) => (
          <option key={entry} value={entry}>
            {formatEnumLabel(entry)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function ConsultationPricingModelControl({
  value,
  disabled = false,
  onChange,
}: ConsultationServicePanelFieldsProps) {
  return (
    <div>
      <Label htmlFor='consultation-pricing-model'>Pricing model</Label>
      <Select
        id='consultation-pricing-model'
        value={value.pricingModel}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...value, pricingModel: event.target.value as ConsultationPricingModel })
        }
      >
        {CONSULTATION_PRICING_MODELS.map((entry) => (
          <option key={entry} value={entry}>
            {formatEnumLabel(entry)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function ConsultationHourlyRateControl({
  value,
  disabled = false,
  onChange,
}: ConsultationServicePanelFieldsProps) {
  return (
    <div>
      <Label htmlFor='consultation-hourly-rate'>Hourly rate</Label>
      <Input
        id='consultation-hourly-rate'
        value={value.defaultHourlyRate}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, defaultHourlyRate: event.target.value })}
      />
    </div>
  );
}

export function ConsultationPackagePriceControl({
  value,
  disabled = false,
  onChange,
}: ConsultationServicePanelFieldsProps) {
  return (
    <div>
      <Label htmlFor='consultation-package-price'>Package price</Label>
      <Input
        id='consultation-package-price'
        value={value.defaultPackagePrice}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, defaultPackagePrice: event.target.value })}
      />
    </div>
  );
}

export function ConsultationPackageSessionsControl({
  value,
  disabled = false,
  onChange,
}: ConsultationServicePanelFieldsProps) {
  return (
    <div>
      <Label htmlFor='consultation-package-sessions'>Package sessions</Label>
      <Input
        id='consultation-package-sessions'
        value={value.defaultPackageSessions}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, defaultPackageSessions: event.target.value })}
      />
    </div>
  );
}

export function ConsultationCurrencyControl({
  value,
  disabled = false,
  onChange,
}: ConsultationServicePanelFieldsProps) {
  const currencyOptions = getCurrencyOptions();
  return (
    <div>
      <Label htmlFor='consultation-currency'>Currency</Label>
      <Select
        id='consultation-currency'
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

export function ConsultationDurationControl({
  value,
  disabled = false,
  onChange,
}: ConsultationServicePanelFieldsProps) {
  return (
    <div>
      <Label htmlFor='consultation-duration-minutes'>Duration (minutes)</Label>
      <Input
        id='consultation-duration-minutes'
        value={value.durationMinutes}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, durationMinutes: event.target.value })}
        placeholder='e.g. 60'
      />
    </div>
  );
}

export function ConsultationMaxGroupSizeControl({
  value,
  disabled = false,
  onChange,
}: ConsultationServicePanelFieldsProps) {
  return (
    <div>
      <Label htmlFor='consultation-max-group-size'>Max group size</Label>
      <Input
        id='consultation-max-group-size'
        value={value.maxGroupSize}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, maxGroupSize: event.target.value })}
      />
    </div>
  );
}

export interface ConsultationInstancePanelFieldsProps {
  value: ConsultationFormState;
  disabled?: boolean;
  onChange: (value: ConsultationFormState) => void;
}

/** Instance Row D: pricing model, hourly rate, currency (parent adds instructor as col 1). */
export function ConsultationInstanceRowDFields({
  value,
  disabled = false,
  onChange,
}: ConsultationInstancePanelFieldsProps) {
  const currencyOptions = getCurrencyOptions();
  return (
    <>
      <div>
        <Label htmlFor='instance-consultation-pricing-model'>Pricing model</Label>
        <Select
          id='instance-consultation-pricing-model'
          value={value.pricingModel}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, pricingModel: event.target.value as ConsultationPricingModel })
          }
        >
          {CONSULTATION_PRICING_MODELS.map((entry) => (
            <option key={entry} value={entry}>
              {formatEnumLabel(entry)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor='instance-consultation-hourly-rate'>Hourly rate</Label>
        <Input
          id='instance-consultation-hourly-rate'
          value={value.defaultHourlyRate}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, defaultHourlyRate: event.target.value })}
        />
      </div>
      <div>
        <Label htmlFor='instance-consultation-currency'>Currency</Label>
        <Select
          id='instance-consultation-currency'
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
    </>
  );
}

/** Instance Row E: package sessions only. */
export function ConsultationInstanceRowEFields({
  value,
  disabled = false,
  onChange,
}: ConsultationInstancePanelFieldsProps) {
  return (
    <>
      <div>
        <Label htmlFor='instance-consultation-package-sessions'>Package sessions</Label>
        <Input
          id='instance-consultation-package-sessions'
          value={value.defaultPackageSessions}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, defaultPackageSessions: event.target.value })}
        />
      </div>
      <div aria-hidden className='hidden md:col-span-3 md:block' />
    </>
  );
}

export function ConsultationInstancePanelFields(props: ConsultationInstancePanelFieldsProps) {
  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-1 gap-3 md:grid-cols-4'>
        <ConsultationInstanceRowDFields {...props} />
      </div>
      <div className='grid grid-cols-1 gap-3 md:grid-cols-4'>
        <ConsultationInstanceRowEFields {...props} />
      </div>
    </div>
  );
}
