'use client';

import { AdminDisclosure } from '@/components/ui/admin-disclosure';

export interface EntityServicesSectionProps {
  id: string;
  labels: string[];
}

export function EntityServicesSection({ id, labels }: EntityServicesSectionProps) {
  if (labels.length === 0) {
    return null;
  }

  return (
    <AdminDisclosure id={id} title='Services' summary={labels.length}>
      <ul className='space-y-1 pt-1 text-sm text-slate-700'>
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </AdminDisclosure>
  );
}
