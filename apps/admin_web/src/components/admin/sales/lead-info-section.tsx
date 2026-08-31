import type { LeadDetail } from '@/types/leads';

import { Card } from '@/components/ui/card';
import { formatEnumLabel } from '@/lib/format';
import { formatPhoneInternationalDisplay } from '@/lib/phone-display';

export interface LeadInfoSectionProps {
  lead: LeadDetail;
}

export function LeadInfoSection({ lead }: LeadInfoSectionProps) {
  return (
    <Card title='Lead Info' className='space-y-2'>
      <div className='grid grid-cols-1 gap-2 text-sm text-slate-700'>
        <p>
          <span className='font-medium text-slate-900'>Name:</span>{' '}
          {[lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(' ') || '—'}
        </p>
        <p>
          <span className='font-medium text-slate-900'>Email:</span> {lead.contact.email ?? '—'}
        </p>
        <p>
          <span className='font-medium text-slate-900'>Phone:</span>{' '}
          {formatPhoneInternationalDisplay(lead.contact) ?? '—'}
        </p>
        <p>
          <span className='font-medium text-slate-900'>Instagram:</span>{' '}
          {lead.contact.instagramHandle ?? '—'}
        </p>
        <p>
          <span className='font-medium text-slate-900'>Source:</span>{' '}
          {lead.contact.source ? formatEnumLabel(lead.contact.source) : '—'}
        </p>
        <p>
          <span className='font-medium text-slate-900'>Lead type:</span> {formatEnumLabel(lead.leadType)}
        </p>
      </div>
    </Card>
  );
}
