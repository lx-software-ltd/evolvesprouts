'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SERVICE_KEY_PATTERN } from '@/lib/service-key-utils';
import type { ServiceDeliveryMode, ServiceStatus } from '@/types/services';

export interface ServiceKeyFieldProps {
  value: string;
  onChange: (next: string) => void;
  serviceKeyUsageLoadError?: string;
  serviceKeyConflictError?: string;
  /** When set with empty value, show amber warning (e.g. published bookable types). */
  publishedBookableKeyWarning?: string;
}

export function ServiceKeyField({
  value,
  onChange,
  serviceKeyUsageLoadError,
  serviceKeyConflictError,
  publishedBookableKeyWarning,
}: ServiceKeyFieldProps) {
  return (
    <div>
      <Label htmlFor='service-key'>Service key</Label>
      <Input
        id='service-key'
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onChange(value.trim().toLowerCase())}
        placeholder='e.g. my-best-auntie-training-course'
        autoComplete='off'
      />
      {value.trim() && !SERVICE_KEY_PATTERN.test(value.trim()) ? (
        <p className='mt-1 text-xs text-red-600'>
          Use lowercase letters and numbers, with single hyphens between segments (no leading or trailing
          hyphen).
        </p>
      ) : null}
      {serviceKeyUsageLoadError ? <p className='mt-1 text-xs text-amber-700'>{serviceKeyUsageLoadError}</p> : null}
      {publishedBookableKeyWarning ? (
        <p className='mt-1 text-xs text-amber-700'>{publishedBookableKeyWarning}</p>
      ) : null}
      {serviceKeyConflictError ? <p className='mt-1 text-xs text-red-600'>{serviceKeyConflictError}</p> : null}
    </div>
  );
}

export interface ServiceFormState {
  title: string;
  description: string;
  serviceKey: string;
  deliveryMode: ServiceDeliveryMode;
  status: ServiceStatus;
}
