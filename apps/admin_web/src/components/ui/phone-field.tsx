'use client';

import { useId, useMemo } from 'react';
import { clsx } from 'clsx';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PHONE_COUNTRIES } from '@/lib/phone-countries.generated';

type PhoneCountryRow = (typeof PHONE_COUNTRIES)[number];

/** Compact dropdown rows: generated countries plus optional synthetic drift row. */
type CompactSelectRow =
  | PhoneCountryRow
  | { region: string; dialCode: string; englishName: string };

export interface PhoneFieldProps {
  region: string;
  national: string;
  onRegionChange: (region: string) => void;
  onNationalChange: (national: string) => void;
  regionLabel: string;
  nationalLabel: string;
  nationalInputId?: string;
  variant?: 'default' | 'compact';
  combinedLabel?: string;
  className?: string;
}

function buildDedupedByDialCode(): PhoneCountryRow[] {
  const seenDial = new Set<string>();
  const out: PhoneCountryRow[] = [];
  for (const row of PHONE_COUNTRIES) {
    if (seenDial.has(row.dialCode)) {
      continue;
    }
    seenDial.add(row.dialCode);
    out.push(row);
  }
  return out;
}

function buildCompactSelectRows(region: string): CompactSelectRow[] {
  const deduped = buildDedupedByDialCode();
  const canonicalRegions = new Set<string>(deduped.map((r) => r.region));

  if (!region || canonicalRegions.has(region)) {
    return deduped;
  }

  const direct = PHONE_COUNTRIES.find((r) => r.region === region);
  if (direct) {
    return [direct, ...deduped];
  }

  if (typeof console !== 'undefined' && console.warn) {
    console.warn('PhoneField: unknown phone_region not found in PHONE_COUNTRIES', region);
  }
  const driftRow: CompactSelectRow = { region, dialCode: '', englishName: region };
  return [driftRow, ...deduped];
}

export function PhoneField({
  region,
  national,
  onRegionChange,
  onNationalChange,
  regionLabel,
  nationalLabel,
  nationalInputId,
  variant = 'default',
  combinedLabel,
  className,
}: PhoneFieldProps) {
  const autoId = useId();
  const regionId = `${autoId}-region`;
  const nationalId = nationalInputId ?? `${autoId}-national`;

  const compactSelectRows = useMemo((): CompactSelectRow[] => {
    if (variant !== 'compact') {
      return [];
    }
    return buildCompactSelectRows(region);
  }, [variant, region]);

  if (variant === 'default') {
    return (
      <div className={clsx('grid gap-3 sm:grid-cols-2 sm:gap-4', className)}>
        <div className='space-y-1.5'>
          <Label htmlFor={regionId}>{regionLabel}</Label>
          <Select id={regionId} value={region} onChange={(event) => onRegionChange(event.target.value)}>
            {PHONE_COUNTRIES.map((row) => (
              <option key={row.region} value={row.region}>
                {row.englishName} (+{row.dialCode})
              </option>
            ))}
          </Select>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor={nationalId}>{nationalLabel}</Label>
          <Input
            id={nationalId}
            type='tel'
            inputMode='numeric'
            autoComplete='tel-national'
            value={national}
            onChange={(event) => onNationalChange(event.target.value)}
            onBlur={() => onNationalChange(national.replace(/\D/g, ''))}
          />
        </div>
      </div>
    );
  }

  const visibleLabel = combinedLabel ?? nationalLabel;

  return (
    <div className={clsx('space-y-1.5', className)}>
      <Label htmlFor={nationalId}>{visibleLabel}</Label>
      <div className='flex items-stretch gap-2'>
        <Select
          aria-label={regionLabel}
          value={region}
          onChange={(event) => onRegionChange(event.target.value)}
          // 40/60 split: the dial-code prefix needs room for "+852"-style
          // labels; the national number rarely exceeds ten digits.
          className='basis-2/5 shrink-0 min-w-0'
        >
          {compactSelectRows.map((row) => {
            const isDrift = row.dialCode === '' && !PHONE_COUNTRIES.some((p) => p.region === row.region);
            const label = isDrift ? row.region : `+${row.dialCode}`;
            return (
              <option key={`${row.region}-${row.dialCode}`} value={row.region} title={row.englishName}>
                {label}
              </option>
            );
          })}
        </Select>
        <Input
          id={nationalId}
          className='basis-3/5 min-w-0'
          type='tel'
          inputMode='numeric'
          autoComplete='tel-national'
          value={national}
          onChange={(event) => onNationalChange(event.target.value)}
          onBlur={() => onNationalChange(national.replace(/\D/g, ''))}
        />
      </div>
    </div>
  );
}
