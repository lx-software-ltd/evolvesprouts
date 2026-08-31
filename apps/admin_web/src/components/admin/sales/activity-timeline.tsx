import type { AdminUser, LeadEvent } from '@/types/leads';

import { Card } from '@/components/ui/card';
import { formatDate, formatEnumLabel } from '@/lib/format';

export interface ActivityTimelineProps {
  events: LeadEvent[];
  users: AdminUser[];
}

function resolveActorLabel(createdBy: string | null, users: AdminUser[]): string {
  if (!createdBy) {
    return 'System';
  }
  const match = users.find((user) => user.sub === createdBy);
  if (!match) {
    return createdBy;
  }
  return match.name || match.email || match.sub;
}

export function ActivityTimeline({ events, users }: ActivityTimelineProps) {
  return (
    <Card title='Activity Timeline' className='h-full'>
      <ol className='space-y-3'>
        {events.length === 0 ? (
          <li className='text-sm text-slate-600'>No activity yet.</li>
        ) : (
          events.map((event) => (
            <li key={event.id} className='border-l-2 border-slate-200 pl-3'>
              <p className='text-sm font-medium text-slate-900'>{formatEnumLabel(event.eventType)}</p>
              <p className='text-xs text-slate-600'>
                By {resolveActorLabel(event.createdBy, users)} • {formatDate(event.createdAt)}
              </p>
            </li>
          ))
        )}
      </ol>
    </Card>
  );
}
